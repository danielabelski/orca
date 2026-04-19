import { app, ipcMain, shell } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

// Why: per error-boundary-design.md §B1, forwarded renderer crashes are written
// to <userData>/logs/renderer-crashes.log so they survive renderer death and are
// reachable via `orca logs`. Keeping size bounded is a hard requirement: a loop
// in the global-handler path could otherwise fill the user's disk.
const MAX_BYTES = 5 * 1024 * 1024
const MAX_ROTATIONS = 3
// Why: a single renderer payload must not dominate the log. Without these
// caps a runaway error loop sending megabyte-sized stacks could force
// rotation on every entry, evicting useful history.
const MAX_FIELD_CHARS = 8 * 1024
const MAX_EXTRA_CHARS = 16 * 1024

let _logFile: string | null = null

function getLogDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function getLogFile(): string {
  if (_logFile) {
    return _logFile
  }
  _logFile = join(getLogDir(), 'renderer-crashes.log')
  return _logFile
}

function ensureLogDir(): void {
  try {
    mkdirSync(getLogDir(), { recursive: true })
  } catch {
    // Best-effort: if we can't create the dir we still attempt to write below.
  }
}

function rotateIfNeeded(file: string): void {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return
  }
  if (size < MAX_BYTES) {
    return
  }
  // Rotate: .2 -> .3 (dropped), .1 -> .2, .log -> .1
  try {
    const oldest = `${file}.${MAX_ROTATIONS}`
    if (existsSync(oldest)) {
      unlinkSync(oldest)
    }
  } catch {
    /* ignore */
  }
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const src = `${file}.${i}`
    const dst = `${file}.${i + 1}`
    try {
      if (existsSync(src)) {
        renameSync(src, dst)
      }
    } catch {
      /* ignore */
    }
  }
  try {
    renameSync(file, `${file}.1`)
  } catch {
    /* ignore */
  }
}

const VALID_KINDS = [
  'render',
  'unhandled-rejection',
  'window-error',
  'renderer-gone',
  'ipc-rejection',
  'ipc-listener'
] as const
type RendererCrashKind = (typeof VALID_KINDS)[number]

export type RendererCrashPayload = {
  ts?: number
  kind: RendererCrashKind
  message?: string
  stack?: string
  componentStack?: string
  boundary?: string
  channel?: string
  appVersion?: string
  extra?: unknown
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value == null) {
    return value
  }
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value
}

function truncateExtra(extra: unknown): unknown {
  if (extra == null) {
    return extra
  }
  try {
    const serialized = JSON.stringify(extra)
    if (serialized.length <= MAX_EXTRA_CHARS) {
      return extra
    }
    return `${serialized.slice(0, MAX_EXTRA_CHARS)}…[truncated]`
  } catch {
    return '[unserializable]'
  }
}

export function appendRendererCrashEntry(payload: RendererCrashPayload): void {
  try {
    ensureLogDir()
    const file = getLogFile()
    rotateIfNeeded(file)
    const entry = {
      ts: payload.ts ?? Date.now(),
      kind: payload.kind,
      message: truncate(payload.message, MAX_FIELD_CHARS),
      stack: truncate(payload.stack, MAX_FIELD_CHARS),
      componentStack: truncate(payload.componentStack, MAX_FIELD_CHARS),
      boundary: payload.boundary,
      channel: payload.channel,
      appVersion: payload.appVersion ?? app.getVersion(),
      extra: truncateExtra(payload.extra)
    }
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    // Never throw: the crash-log sink must not itself become a crash source.
    console.error('[renderer-crash-log] failed to append entry', error)
  }
}

export function getRendererCrashLogPath(): string {
  return getLogFile()
}

let registered = false

export function registerRendererCrashLogHandler(): void {
  if (registered) {
    return
  }
  registered = true
  // Why: registered before window creation so a crash during initial load is
  // still captured — see B1 "Registration order" in the design doc.
  ipcMain.on('log:renderer-crash', (_event, payload: RendererCrashPayload) => {
    if (!payload || typeof payload !== 'object') {
      return
    }
    // Why: reject unknown kinds so a buggy renderer cannot pollute the log
    // with values that break downstream kind-based filtering.
    if (!VALID_KINDS.includes(payload.kind)) {
      return
    }
    appendRendererCrashEntry(payload)
  })
  ipcMain.handle('log:revealRendererCrashLog', async () => {
    try {
      ensureLogDir()
      shell.showItemInFolder(getLogFile())
      return true
    } catch {
      return false
    }
  })
}
