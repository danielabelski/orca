import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import { createTestStore } from './store-test-helpers'

// Why: queueMicrotask is used by the agent-status slice to schedule the
// freshness timer after state updates. In tests we need to flush microtasks
// before advancing fake timers so the setTimeout gets registered.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

describe('agent status freshness expiry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances agentStatusEpoch when a fresh entry crosses the stale threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', statusText: 'Fix tests', promptText: '' },
        'codex'
      )

    // setAgentStatus bumps epoch once synchronously
    expect(store.getState().agentStatusEpoch).toBe(1)

    // Flush the queueMicrotask that schedules the freshness timer
    await flushMicrotasks()

    vi.advanceTimersByTime(AGENT_STATUS_STALE_AFTER_MS + 1)

    // Timer bump adds another increment
    expect(store.getState().agentStatusEpoch).toBe(2)
  })

  it('cancels the scheduled freshness tick when the entry is removed first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', statusText: 'Fix tests', promptText: '' },
        'codex'
      )
    // set bumps to 1, remove bumps to 2
    store.getState().removeAgentStatus('tab-1:1')
    expect(store.getState().agentStatusEpoch).toBe(2)

    // Flush microtask and advance past stale threshold
    await flushMicrotasks()
    vi.advanceTimersByTime(AGENT_STATUS_STALE_AFTER_MS + 1)

    // No additional bump since the entry was removed before the timer fires
    expect(store.getState().agentStatusEpoch).toBe(2)
  })
})

describe('agent status elapsed timing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves stateStartedAt across in-state updates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', statusText: 'Start fix', promptText: 'Fix login flow' },
        'codex'
      )

    const startedAt = store.getState().agentStatusByPaneKey['tab-1:1']?.stateStartedAt
    expect(startedAt).toBe(Date.now())

    vi.advanceTimersByTime(15_000)
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', statusText: 'Still fixing', promptText: '' },
        'codex'
      )

    const entry = store.getState().agentStatusByPaneKey['tab-1:1']
    expect(entry?.stateStartedAt).toBe(startedAt)
    expect(entry?.updatedAt).toBe(Date.now())
    expect(entry?.promptText).toBe('Fix login flow')
  })

  it('records the previous state start time in history when the state changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', statusText: 'Start fix', promptText: '' },
        'codex'
      )

    const workingStartedAt = store.getState().agentStatusByPaneKey['tab-1:1']?.stateStartedAt

    vi.advanceTimersByTime(15_000)
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'blocked', statusText: 'Need input', promptText: '' },
        'codex'
      )

    const entry = store.getState().agentStatusByPaneKey['tab-1:1']
    expect(entry?.stateStartedAt).toBe(Date.now())
    expect(entry?.stateHistory).toEqual([
      {
        state: 'working',
        statusText: 'Start fix',
        promptText: '',
        startedAt: workingStartedAt
      }
    ])
  })
})
