import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import type { SubprocessHandle } from './session'
import type * as DaemonInitModule from './daemon-init'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
    getAppPath: () => process.cwd(),
    isPackaged: false
  }
}))

// Why: we want the real DaemonServer + DaemonClient but not electron-based
// subprocess spawning. createTestDaemon() wires a mock subprocess harness
// compatible with daemon-spawner.test.ts.
function createMockSubprocess(): SubprocessHandle {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 77777,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => setTimeout(() => onExitCb?.(0), 5)),
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData(_cb: (data: string) => void) {},
    onExit(cb: (code: number) => void) {
      onExitCb = cb
    }
  }
}

async function importFreshDaemonInit(): Promise<typeof DaemonInitModule> {
  vi.resetModules()
  return import('./daemon-init')
}

describe('cleanupOrphanedDaemon', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'daemon-init-test-'))
    getPathMock.mockImplementation(() => userDataDir)
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns cleaned=false when no daemon socket exists', async () => {
    const { cleanupOrphanedDaemon } = await importFreshDaemonInit()

    const result = await cleanupOrphanedDaemon()
    expect(result.cleaned).toBe(false)
    expect(result.killedCount).toBe(0)
  })

  it('kills live sessions and shuts down a running daemon', async () => {
    const { cleanupOrphanedDaemon } = await importFreshDaemonInit()
    const { DaemonSpawner, getDaemonSocketPath } = await import('./daemon-spawner')
    const { startDaemon } = await import('./daemon-main')
    const { DaemonClient } = await import('./client')

    const runtimeDir = join(userDataDir, 'daemon')
    const { mkdirSync } = await import('fs')
    mkdirSync(runtimeDir, { recursive: true })

    // Spin up a real daemon exactly where cleanupOrphanedDaemon will look.
    const daemonHandles: { shutdown: () => Promise<void> }[] = []
    const spawner = new DaemonSpawner({
      runtimeDir,
      launcher: async (socketPath, tokenPath) => {
        const handle = await startDaemon({
          socketPath,
          tokenPath,
          spawnSubprocess: () => createMockSubprocess()
        })
        daemonHandles.push(handle)
        return { shutdown: () => handle.shutdown() }
      }
    })
    const info = await spawner.ensureRunning()

    // Create two sessions so killedCount is non-zero.
    const client = new DaemonClient({
      socketPath: info.socketPath,
      tokenPath: info.tokenPath
    })
    await client.ensureConnected()
    await client.request('createOrAttach', { sessionId: 'a', cols: 80, rows: 24 })
    await client.request('createOrAttach', { sessionId: 'b', cols: 80, rows: 24 })
    client.disconnect()

    // Now the daemon looks "orphaned" from cleanupOrphanedDaemon's POV.
    const result = await cleanupOrphanedDaemon()
    expect(result.cleaned).toBe(true)
    expect(result.killedCount).toBeGreaterThanOrEqual(2)

    // Socket file should be gone so a later opt-in relaunch can bind cleanly.
    if (process.platform !== 'win32') {
      expect(existsSync(getDaemonSocketPath(runtimeDir))).toBe(false)
    }

    // Best-effort teardown of any surviving handles from the spawner side.
    for (const handle of daemonHandles) {
      await handle.shutdown().catch(() => {})
    }
  })
})
