/**
 * E2E tests for dragging tabs across tab groups.
 *
 * User Prompt:
 * - playwright tests for drag-tabs-across-groups
 *
 * Why headful: dnd-kit's PointerSensor needs real pointer events to fire,
 * including its 5px distance activation constraint. Headless Electron does
 * not reliably dispatch the pointer sequence needed to start a drag, so
 * every test here is tagged @headful and runs under the electron-headful
 * project. The whole suite is serial so Playwright never tries to open
 * multiple visible Electron windows at once.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getWorktreeTabs,
  ensureTerminalVisible
} from './helpers/store'

type GroupSnapshot = { id: string; tabOrder: string[] }

async function createTerminalTab(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((targetWorktreeId) => {
    const store = window.__store
    if (!store) {
      return
    }
    const state = store.getState()
    const newTab = state.createTab(targetWorktreeId)
    state.setActiveTabType('terminal')
    const tabs = state.tabsByWorktree[targetWorktreeId] ?? []
    state.setTabBarOrder(
      targetWorktreeId,
      tabs
        .map((tab) => (tab.id === newTab.id ? null : tab.id))
        .filter(Boolean)
        .concat(newTab.id)
    )
  }, worktreeId)
}

async function getGroupSnapshot(page: Page, worktreeId: string): Promise<GroupSnapshot[]> {
  return page.evaluate((wt) => {
    const store = window.__store
    if (!store) {
      return []
    }
    const groups = store.getState().groupsByWorktree?.[wt] ?? []
    return groups.map((g: { id: string; tabOrder: string[] }) => ({
      id: g.id,
      tabOrder: [...g.tabOrder]
    }))
  }, worktreeId)
}

async function splitActiveGroupRight(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate((wt) => {
    const store = window.__store
    if (!store) {
      return null
    }
    const state = store.getState()
    const groups = state.groupsByWorktree?.[wt] ?? []
    const activeId = state.activeGroupIdByWorktree?.[wt] ?? groups[0]?.id
    if (!activeId) {
      return null
    }
    return state.createEmptySplitGroup(wt, activeId, 'right') ?? null
  }, worktreeId)
}

async function moveTabToGroup(
  page: Page,
  unifiedTabId: string,
  targetGroupId: string
): Promise<void> {
  await page.evaluate(
    ([id, group]) => {
      window.__store?.getState().moveUnifiedTabToGroup(id, group, { activate: false })
    },
    [unifiedTabId, targetGroupId] as const
  )
}

async function getUnifiedTabGroupId(page: Page, unifiedTabId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const store = window.__store
    if (!store) {
      return null
    }
    const byWorktree = store.getState().unifiedTabsByWorktree ?? {}
    for (const tabs of Object.values(byWorktree) as { id: string; groupId: string }[][]) {
      const match = tabs.find((t) => t.id === id)
      if (match) {
        return match.groupId
      }
    }
    return null
  }, unifiedTabId)
}

/**
 * Drive a real pointer drag from one tab element to another.
 *
 * Why: dnd-kit's PointerSensor requires (a) a 5px movement after pointerdown
 * to activate and (b) intermediate pointermoves to fire onDragOver against
 * the target droppable. The nudge + stepped move satisfies both.
 */
async function dragTabTo(
  page: Page,
  sourceUnifiedTabId: string,
  targetUnifiedTabId: string
): Promise<void> {
  const sourceLocator = page.locator(`[data-unified-tab-id="${sourceUnifiedTabId}"]`).first()
  const targetLocator = page.locator(`[data-unified-tab-id="${targetUnifiedTabId}"]`).first()
  await expect(sourceLocator).toBeVisible({ timeout: 5_000 })
  await expect(targetLocator).toBeVisible({ timeout: 5_000 })

  const sourceBox = await sourceLocator.boundingBox()
  const targetBox = await targetLocator.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Could not resolve bounding boxes for drag source/target')
  }

  const sx = sourceBox.x + sourceBox.width / 2
  const sy = sourceBox.y + sourceBox.height / 2
  const tx = targetBox.x + targetBox.width / 2
  const ty = targetBox.y + targetBox.height / 2

  await page.mouse.move(sx, sy)
  await page.mouse.down()
  // Nudge >5px to clear PointerSensor's activationConstraint.distance.
  await page.mouse.move(sx + 10, sy, { steps: 5 })
  // Step the pointer across the UI so onDragOver fires on intermediate
  // droppables and dnd-kit resolves the final insertion index.
  await page.mouse.move(tx, ty, { steps: 25 })
  // Linger a tick at the target so the last onDragOver lands before drop.
  await page.mouse.move(tx, ty)
  await page.mouse.up()
}

test.describe.configure({ mode: 'serial' })
test.describe('Cross-group tab drag', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  /**
   * Drags a tab from one group into another and asserts both groups updated.
   *
   * Why two assertions (source shrank, target grew): dnd-kit's drag lifecycle
   * fires onDragEnd once, but the state transition calls two store actions —
   * moveUnifiedTabToGroup (updates target) and source-group cleanup. Both
   * sides must be verified or a regression in either half would pass silently.
   */
  test('@headful drags a tab from one group into another', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    // Seed three tabs so group A keeps two after we populate group B.
    // Two in A matters: if we left only one in A after seeding B, the
    // empty-source-group cleanup path could fire on drop and change the
    // number of groups — confusing this test's assertions with the
    // separate cleanup behavior exercised below.
    await createTerminalTab(orcaPage, worktreeId)
    await createTerminalTab(orcaPage, worktreeId)
    await expect
      .poll(async () => (await getWorktreeTabs(orcaPage, worktreeId)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3)

    const targetGroupId = await splitActiveGroupRight(orcaPage, worktreeId)
    expect(targetGroupId).toBeTruthy()

    const groupsBefore = await getGroupSnapshot(orcaPage, worktreeId)
    const sourceGroup = groupsBefore.find((g) => g.id !== targetGroupId)!
    expect(sourceGroup.tabOrder.length).toBeGreaterThanOrEqual(3)
    const sourceGroupId = sourceGroup.id

    // Take two unified-tab IDs from group A: one we move to B up front
    // so B's tab bar has a DOM element we can hit with the pointer, and
    // one we drag across in the real pointer test.
    const [draggedUnifiedId, seedUnifiedId] = sourceGroup.tabOrder

    await moveTabToGroup(orcaPage, seedUnifiedId, targetGroupId!)
    await expect
      .poll(async () => getUnifiedTabGroupId(orcaPage, seedUnifiedId), { timeout: 5_000 })
      .toBe(targetGroupId)

    // Real pointer drag: drop draggedUnifiedId on top of seedUnifiedId.
    await dragTabTo(orcaPage, draggedUnifiedId, seedUnifiedId)

    await expect
      .poll(async () => getUnifiedTabGroupId(orcaPage, draggedUnifiedId), {
        timeout: 5_000,
        message: 'Dragged tab did not land in the target group'
      })
      .toBe(targetGroupId)

    const groupsAfter = await getGroupSnapshot(orcaPage, worktreeId)
    const targetAfter = groupsAfter.find((g) => g.id === targetGroupId)
    const sourceAfter = groupsAfter.find((g) => g.id === sourceGroupId)
    expect(targetAfter?.tabOrder, 'dragged tab must appear in target group').toContain(
      draggedUnifiedId
    )
    expect(sourceAfter?.tabOrder, 'dragged tab must be removed from source group').not.toContain(
      draggedUnifiedId
    )
    expect(sourceAfter?.tabOrder, 'tabs we did not drag must remain in source').toEqual(
      sourceGroup.tabOrder.filter((id) => id !== draggedUnifiedId && id !== seedUnifiedId)
    )
  })

  /**
   * User Prompt:
   * - dragging tabs around to reorder them (via real pointer, not store call)
   *
   * Why assert the exact new order (not just "changed"): a reorder bug that
   * swaps the wrong tabs — or no-ops and returns the prior array in a new
   * reference — would pass a "not equal to before" check. Asserting the
   * specific post-drag order catches both classes of regression.
   */
  test('@headful reorders tabs within a group via pointer drag', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    await createTerminalTab(orcaPage, worktreeId)
    await expect
      .poll(async () => (await getWorktreeTabs(orcaPage, worktreeId)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2)

    const groupsBefore = await getGroupSnapshot(orcaPage, worktreeId)
    const group = groupsBefore[0]
    expect(group.tabOrder.length).toBeGreaterThanOrEqual(2)
    const [firstUnified, secondUnified] = group.tabOrder
    const expectedOrder = [secondUnified, firstUnified, ...group.tabOrder.slice(2)]

    // Drag the first tab onto the second tab's center. The dnd-kit insertion
    // logic uses pointer-vs-midpoint on the hovered tab — landing on its
    // center + the 25-step move means the final pointer position is past
    // the midpoint, so the dragged tab is inserted AFTER the second tab
    // (i.e. the two are swapped).
    await dragTabTo(orcaPage, firstUnified, secondUnified)

    await expect
      .poll(
        async () => {
          const after = await getGroupSnapshot(orcaPage, worktreeId)
          return after.find((g) => g.id === group.id)?.tabOrder ?? []
        },
        { timeout: 5_000, message: 'Tab order did not match expected swap after pointer drag' }
      )
      .toEqual(expectedOrder)
  })

  /**
   * Exercises the empty-source-group cleanup path: when the last tab is
   * dragged out of a group, that group is collapsed out of the layout.
   *
   * Why this is a distinct test: the cleanup path lives in
   * maybeCloseEmptySourceGroup inside TabGroupDndContext and runs only
   * after a cross-group move leaves the source empty. It is separate from
   * moveUnifiedTabToGroup itself and is easy to regress when either the
   * DnD context or the store's closeEmptyGroup contract changes.
   */
  test('@headful dragging the last tab out collapses the empty source group', async ({
    orcaPage
  }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    // Two tabs total: one stays in group A as the drop target, one gets
    // moved into group B up front. Then we'll drag the remaining A tab
    // into B, leaving A empty.
    await createTerminalTab(orcaPage, worktreeId)
    await expect
      .poll(async () => (await getWorktreeTabs(orcaPage, worktreeId)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2)

    const targetGroupId = await splitActiveGroupRight(orcaPage, worktreeId)
    expect(targetGroupId).toBeTruthy()

    const groupsBefore = await getGroupSnapshot(orcaPage, worktreeId)
    const sourceGroup = groupsBefore.find((g) => g.id !== targetGroupId)!
    const sourceGroupId = sourceGroup.id
    expect(sourceGroup.tabOrder.length).toBeGreaterThanOrEqual(2)

    const [lastInSourceUnifiedId, seedUnifiedId] = sourceGroup.tabOrder

    await moveTabToGroup(orcaPage, seedUnifiedId, targetGroupId!)
    await expect
      .poll(async () => getUnifiedTabGroupId(orcaPage, seedUnifiedId), { timeout: 5_000 })
      .toBe(targetGroupId)

    // Confirm group A is now the source's lone-tab state before we drag.
    const groupsMid = await getGroupSnapshot(orcaPage, worktreeId)
    expect(
      groupsMid.find((g) => g.id === sourceGroupId)?.tabOrder,
      'source must still exist with one tab prior to the final drag'
    ).toEqual([lastInSourceUnifiedId])

    await dragTabTo(orcaPage, lastInSourceUnifiedId, seedUnifiedId)

    await expect
      .poll(
        async () => {
          const after = await getGroupSnapshot(orcaPage, worktreeId)
          return after.some((g) => g.id === sourceGroupId)
        },
        {
          timeout: 5_000,
          message: 'Empty source group was not removed after its last tab was dragged away'
        }
      )
      .toBe(false)

    const groupsAfter = await getGroupSnapshot(orcaPage, worktreeId)
    expect(groupsAfter).toHaveLength(1)
    expect(groupsAfter[0].id).toBe(targetGroupId)
    expect(groupsAfter[0].tabOrder).toContain(lastInSourceUnifiedId)
  })
})
