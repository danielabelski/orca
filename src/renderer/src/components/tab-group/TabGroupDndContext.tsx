/* eslint-disable max-lines -- Why: the cross-group DnD context must keep
 * collision detection, drag-state management, and drop-commit logic together
 * so the multi-phase drag lifecycle stays atomic and debuggable. */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type CollisionDetectionArgs,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { FileCode, Globe, TerminalSquare } from 'lucide-react'
import type { Tab } from '../../../../shared/types'
import { useAppStore } from '../../store'
import {
  CrossGroupDndContextPresent,
  CrossGroupDragStateContext,
  parseGroupContentId,
  parseGroupDropId,
  parseSharedSortableId,
  type CrossGroupDragState,
  type SplitDropDirection,
  type TabDragData
} from './CrossGroupDragContext'

type GroupVisibleTab = {
  unifiedTabId: string
  visibleId: string
}

function pointInRect(point: { x: number; y: number }, rect?: ClientRect | null): boolean {
  if (!rect) {
    return false
  }
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )
}

function makeCollision(containerId: string, args: CollisionDetectionArgs): Collision[] {
  const container = args.droppableContainers.find(
    (candidate) => String(candidate.id) === containerId
  )
  return container ? [{ id: container.id, data: { droppableContainer: container, value: 1 } }] : []
}

function toVisibleTabId(tab: Tab): string {
  return tab.contentType === 'terminal' || tab.contentType === 'browser' ? tab.entityId : tab.id
}

const EDGE_LOCK_THRESHOLD = 0.22
const EDGE_RELEASE_THRESHOLD = 0.35

function isStillInsideLockedEdge(
  direction: Exclude<SplitDropDirection, 'center'>,
  relativeX: number,
  relativeY: number
): boolean {
  if (direction === 'left') {
    return relativeX <= EDGE_RELEASE_THRESHOLD
  }
  if (direction === 'right') {
    return relativeX >= 1 - EDGE_RELEASE_THRESHOLD
  }
  if (direction === 'up') {
    return relativeY <= EDGE_RELEASE_THRESHOLD
  }
  return relativeY >= 1 - EDGE_RELEASE_THRESHOLD
}

function getSplitDirection(
  point: { x: number; y: number } | null,
  rect?: ClientRect | null,
  lockedDirection?: SplitDropDirection | null
): SplitDropDirection | null {
  if (!point || !rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const relativeX = (point.x - rect.left) / rect.width
  const relativeY = (point.y - rect.top) / rect.height
  const edgeDistances: { direction: SplitDropDirection; distance: number }[] = []

  if (
    lockedDirection &&
    lockedDirection !== 'center' &&
    isStillInsideLockedEdge(lockedDirection, relativeX, relativeY)
  ) {
    return lockedDirection
  }

  if (relativeX <= EDGE_LOCK_THRESHOLD) {
    edgeDistances.push({ direction: 'left', distance: relativeX })
  }
  if (relativeX >= 1 - EDGE_LOCK_THRESHOLD) {
    edgeDistances.push({ direction: 'right', distance: 1 - relativeX })
  }
  if (relativeY <= EDGE_LOCK_THRESHOLD) {
    edgeDistances.push({ direction: 'up', distance: relativeY })
  }
  if (relativeY >= 1 - EDGE_LOCK_THRESHOLD) {
    edgeDistances.push({ direction: 'down', distance: 1 - relativeY })
  }

  if (edgeDistances.length === 0) {
    return 'center'
  }

  edgeDistances.sort((left, right) => left.distance - right.distance)
  return edgeDistances[0]?.direction ?? 'center'
}

function computeInsertionIndex(
  orderedTabs: GroupVisibleTab[],
  overVisibleId: string,
  pointerX: number | null,
  hoveredRect?: ClientRect | null
): number | null {
  const hoveredIndex = orderedTabs.findIndex((item) => item.visibleId === overVisibleId)
  if (hoveredIndex === -1) {
    return null
  }
  if (pointerX == null || !hoveredRect) {
    return hoveredIndex
  }
  const midpoint = hoveredRect.left + hoveredRect.width / 2
  return hoveredIndex + (pointerX >= midpoint ? 1 : 0)
}

function applyInsertionIndex(
  currentOrder: string[],
  tabId: string,
  insertionIndex: number
): string[] | null {
  const currentIndex = currentOrder.indexOf(tabId)
  if (currentIndex === -1) {
    return null
  }

  const nextOrder = currentOrder.filter((candidate) => candidate !== tabId)
  const adjustedInsertionIndex = currentIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
  const clampedInsertionIndex = Math.max(0, Math.min(adjustedInsertionIndex, nextOrder.length))
  nextOrder.splice(clampedInsertionIndex, 0, tabId)

  return nextOrder.every((candidate, index) => candidate === currentOrder[index]) ? null : nextOrder
}

const EMPTY_DRAG_STATE: CrossGroupDragState = {
  activeTab: null,
  overGroupId: null,
  overTabBarIndex: null,
  overSplitDirection: null
}

export default function TabGroupDndContext({
  worktreeId,
  children
}: {
  worktreeId: string
  children: React.ReactNode
}): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )
  const reorderUnifiedTabs = useAppStore((state) => state.reorderUnifiedTabs)
  const moveUnifiedTabToGroup = useAppStore((state) => state.moveUnifiedTabToGroup)
  const createEmptySplitGroup = useAppStore((state) => state.createEmptySplitGroup)
  const closeEmptyGroup = useAppStore((state) => state.closeEmptyGroup)
  const groups = useAppStore((state) => state.groupsByWorktree[worktreeId] ?? [])
  const unifiedTabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId] ?? [])
  const [dragState, setDragState] = useState<CrossGroupDragState>(EMPTY_DRAG_STATE)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const droppableRectsRef = useRef<Map<string, ClientRect>>(new Map())

  const groupVisibleOrder = useMemo(() => {
    const tabsById = new Map(unifiedTabs.map((tab) => [tab.id, tab]))
    return new Map(
      groups.map((group) => [
        group.id,
        group.tabOrder
          .map((tabId) => tabsById.get(tabId))
          .filter((tab): tab is Tab => tab !== undefined)
          .map((tab) => ({
            unifiedTabId: tab.id,
            visibleId: toVisibleTabId(tab)
          }))
      ])
    )
  }, [groups, unifiedTabs])

  const maybeCloseEmptySourceGroup = useCallback(
    (sourceGroupId: string) => {
      const state = useAppStore.getState()
      const nextGroups = state.groupsByWorktree[worktreeId] ?? []
      const sourceGroup = nextGroups.find((group) => group.id === sourceGroupId)
      if (!sourceGroup || sourceGroup.tabOrder.length > 0 || nextGroups.length <= 1) {
        return
      }
      closeEmptyGroup(worktreeId, sourceGroupId)
    },
    [closeEmptyGroup, worktreeId]
  )

  const collisionDetection = useCallback<CollisionDetection>((args: CollisionDetectionArgs) => {
    if (args.pointerCoordinates) {
      pointerRef.current = args.pointerCoordinates
    }
    droppableRectsRef.current = new Map(
      args.droppableContainers.map((container) => [
        String(container.id),
        args.droppableRects.get(container.id) ?? args.droppableRects.get(String(container.id))
      ])
    )

    if (!args.pointerCoordinates) {
      return closestCenter(args)
    }

    const sortableHits = args.droppableContainers.filter((container) => {
      const parsed = parseSharedSortableId(String(container.id))
      if (!parsed) {
        return false
      }
      return pointInRect(
        args.pointerCoordinates!,
        args.droppableRects.get(container.id) ?? args.droppableRects.get(String(container.id))
      )
    })

    if (sortableHits.length > 0) {
      const parsedTarget = parseSharedSortableId(String(sortableHits[0]?.id))
      if (parsedTarget) {
        const groupSortables = args.droppableContainers.filter(
          (container) =>
            parseSharedSortableId(String(container.id))?.groupId === parsedTarget.groupId
        )
        return closestCenter({ ...args, droppableContainers: groupSortables })
      }
    }

    const tabBarHit = args.droppableContainers.find((container) => {
      const parsed = parseGroupDropId(String(container.id))
      if (!parsed) {
        return false
      }
      return pointInRect(
        args.pointerCoordinates!,
        args.droppableRects.get(container.id) ?? args.droppableRects.get(String(container.id))
      )
    })
    if (tabBarHit) {
      return makeCollision(String(tabBarHit.id), args)
    }

    const contentHit = args.droppableContainers.find((container) => {
      const parsed = parseGroupContentId(String(container.id))
      if (!parsed) {
        return false
      }
      return pointInRect(
        args.pointerCoordinates!,
        args.droppableRects.get(container.id) ?? args.droppableRects.get(String(container.id))
      )
    })
    if (contentHit) {
      return makeCollision(String(contentHit.id), args)
    }

    return []
  }, [])

  const clearDragState = useCallback(() => {
    pointerRef.current = null
    setDragState(EMPTY_DRAG_STATE)
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      if (!activeTab) {
        clearDragState()
        return
      }
      setDragState({
        activeTab,
        overGroupId: activeTab.sourceGroupId,
        overTabBarIndex: null,
        overSplitDirection: null
      })
    },
    [clearDragState]
  )

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const translatedRect = event.active.rect.current.translated
    if (!translatedRect) {
      return
    }
    pointerRef.current = {
      x: translatedRect.left + translatedRect.width / 2,
      y: translatedRect.top + translatedRect.height / 2
    }
  }, [])

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      if (!activeTab || !event.over) {
        setDragState((current) =>
          current.activeTab
            ? {
                activeTab: current.activeTab,
                overGroupId: null,
                overTabBarIndex: null,
                overSplitDirection: null
              }
            : EMPTY_DRAG_STATE
        )
        return
      }

      const overId = String(event.over.id)
      const sortableTarget = parseSharedSortableId(overId)
      if (sortableTarget) {
        const orderedTabs = groupVisibleOrder.get(sortableTarget.groupId) ?? []
        const insertionIndex = computeInsertionIndex(
          orderedTabs,
          sortableTarget.visibleId,
          pointerRef.current?.x ?? null,
          droppableRectsRef.current.get(overId)
        )
        setDragState({
          activeTab,
          overGroupId: sortableTarget.groupId,
          overTabBarIndex: insertionIndex,
          overSplitDirection: null
        })
        return
      }

      const groupDropTarget = parseGroupDropId(overId)
      if (groupDropTarget) {
        const orderedTabs = groupVisibleOrder.get(groupDropTarget.groupId) ?? []
        setDragState({
          activeTab,
          overGroupId: groupDropTarget.groupId,
          overTabBarIndex: orderedTabs.length,
          overSplitDirection: null
        })
        return
      }

      const groupContentTarget = parseGroupContentId(overId)
      if (groupContentTarget) {
        const lockedDirection =
          dragState.overGroupId === groupContentTarget.groupId ? dragState.overSplitDirection : null
        setDragState({
          activeTab,
          overGroupId: groupContentTarget.groupId,
          overTabBarIndex: null,
          overSplitDirection: getSplitDirection(
            pointerRef.current,
            droppableRectsRef.current.get(overId),
            lockedDirection
          )
        })
        return
      }

      clearDragState()
    },
    [clearDragState, dragState.overGroupId, dragState.overSplitDirection, groupVisibleOrder]
  )

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      clearDragState()
    },
    [clearDragState]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeTab = event.active.data.current as TabDragData | undefined
      const currentDragState = dragState
      clearDragState()

      if (!activeTab || !event.over || !currentDragState.overGroupId) {
        return
      }

      const targetGroupId = currentDragState.overGroupId

      if (currentDragState.overTabBarIndex !== null) {
        if (activeTab.sourceGroupId === targetGroupId) {
          const currentOrder =
            groupVisibleOrder.get(targetGroupId)?.map((item) => item.unifiedTabId) ?? []
          const nextOrder = applyInsertionIndex(
            currentOrder,
            activeTab.unifiedTabId,
            currentDragState.overTabBarIndex
          )
          if (nextOrder) {
            reorderUnifiedTabs(targetGroupId, nextOrder)
          }
          return
        }

        moveUnifiedTabToGroup(activeTab.unifiedTabId, targetGroupId, {
          index: currentDragState.overTabBarIndex,
          activate: true
        })
        maybeCloseEmptySourceGroup(activeTab.sourceGroupId)
        return
      }

      if (!currentDragState.overSplitDirection) {
        return
      }

      if (currentDragState.overSplitDirection === 'center') {
        if (activeTab.sourceGroupId !== targetGroupId) {
          moveUnifiedTabToGroup(activeTab.unifiedTabId, targetGroupId, { activate: true })
          maybeCloseEmptySourceGroup(activeTab.sourceGroupId)
        }
        return
      }

      const newGroupId = createEmptySplitGroup(
        worktreeId,
        targetGroupId,
        currentDragState.overSplitDirection
      )
      if (!newGroupId) {
        return
      }

      moveUnifiedTabToGroup(activeTab.unifiedTabId, newGroupId, { activate: true })
      maybeCloseEmptySourceGroup(activeTab.sourceGroupId)
    },
    [
      clearDragState,
      createEmptySplitGroup,
      dragState,
      groupVisibleOrder,
      maybeCloseEmptySourceGroup,
      moveUnifiedTabToGroup,
      reorderUnifiedTabs,
      worktreeId
    ]
  )

  const overlayIcon = (() => {
    if (!dragState.activeTab) {
      return null
    }
    if (dragState.activeTab.contentType === 'terminal') {
      return <TerminalSquare className="size-3.5 shrink-0" />
    }
    if (dragState.activeTab.contentType === 'browser') {
      return <Globe className="size-3.5 shrink-0" />
    }
    return <FileCode className="size-3.5 shrink-0" />
  })()

  return (
    <CrossGroupDndContextPresent.Provider value={true}>
      <CrossGroupDragStateContext.Provider value={dragState}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {children}
          <DragOverlay>
            {dragState.activeTab ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card/95 px-3 py-1.5 text-sm shadow-lg">
                {overlayIcon}
                <span className="max-w-[240px] truncate">{dragState.activeTab.label}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </CrossGroupDragStateContext.Provider>
    </CrossGroupDndContextPresent.Provider>
  )
}
