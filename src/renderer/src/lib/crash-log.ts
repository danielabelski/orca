// Why: renderer-side crash plumbing for error-boundary-design.md Part B. The
// ring buffer in localStorage is the diagnostic fallback when IPC itself is
// the broken thing — the root AppErrorBoundary's "Copy diagnostics" button
// reads from it without any React/store access so the fallback survives even
// when the rest of the renderer is on fire.

import type { RendererCrashForwardPayload, RendererCrashKind } from '../../../preload/api-types'

const RING_KEY = 'orca.crashLog.ring.v1'
const RING_MAX = 50
const DEDUPE_WINDOW_MS = 1000

export type CrashLogEntry = RendererCrashForwardPayload & { ts: number }

// Why: StrictMode mounts effects twice in dev, and some crash paths re-throw
// across both the `error` and `unhandledrejection` events within the same
// microtask. Hashing message|stack over a short window keeps dev logs readable.
// This is a dev-ergonomics tool only — see design §B2: it is not a prod spam
// guard and cannot meaningfully suppress an infinite render loop.
type DedupeEntry = { hash: string; at: number }
const dedupeRecent: DedupeEntry[] = []

function dedupeHit(message: string | undefined, stack: string | undefined): boolean {
  const hash = `${message ?? ''}|${stack ?? ''}`
  const now = Date.now()
  // Drop expired entries.
  while (dedupeRecent.length && now - dedupeRecent[0].at > DEDUPE_WINDOW_MS) {
    dedupeRecent.shift()
  }
  if (dedupeRecent.some((e) => e.hash === hash)) {
    return true
  }
  dedupeRecent.push({ hash, at: now })
  return false
}

function readRing(): CrashLogEntry[] {
  try {
    const raw = localStorage.getItem(RING_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CrashLogEntry[]) : []
  } catch {
    return []
  }
}

function writeRing(entries: CrashLogEntry[]): void {
  const trimmed = entries.length > RING_MAX ? entries.slice(entries.length - RING_MAX) : entries
  try {
    localStorage.setItem(RING_KEY, JSON.stringify(trimmed))
  } catch (err) {
    // Why: QuotaExceededError — drop oldest half and retry once. If that
    // still fails, give up on localStorage and continue; we must not block
    // the IPC send or crash the global handler. See §B2 "Regression Risk".
    if (err instanceof DOMException) {
      try {
        const half = Math.max(1, Math.floor(trimmed.length / 2))
        localStorage.setItem(RING_KEY, JSON.stringify(trimmed.slice(trimmed.length - half)))
      } catch {
        /* give up */
      }
    }
  }
}

function appendRing(entry: CrashLogEntry): void {
  try {
    const entries = readRing()
    entries.push(entry)
    writeRing(entries)
  } catch {
    // Isolated from IPC send: even if the ring-buffer path fails, we still
    // attempt IPC below. The ring buffer must never abort the IPC send.
  }
}

/**
 * Public entry point used by global handlers, boundaries, and IPC wrappers.
 * Always safe to call: never throws.
 */
export function reportRendererCrash(payload: RendererCrashForwardPayload): void {
  const entry: CrashLogEntry = { ...payload, ts: Date.now() }

  // Dev-only dedupe: collapses StrictMode double-fires within a 1s window.
  // Why: in production we want every crash recorded — a real repeated failure
  // is itself a signal, and suppressing it would mask bug-report evidence.
  if (import.meta.env.DEV && dedupeHit(entry.message, entry.stack)) {
    return
  }

  // Ring buffer first so diagnostics exist even when IPC is the broken thing.
  appendRing(entry)

  try {
    window.api?.crashLog?.report(payload)
  } catch {
    // IPC bridge unavailable (tests, or bridge itself faulted) — ring buffer
    // still holds the entry for later retrieval.
  }
}

export function readCrashRingBuffer(): CrashLogEntry[] {
  return readRing()
}

export function formatCrashDiagnostics(error: Error | null, componentStack?: string): string {
  const entries = readRing()
  const lines: string[] = []
  lines.push(`userAgent: ${navigator.userAgent}`)
  if (error) {
    lines.push(`error: ${error.message}`)
    if (error.stack) {
      lines.push(error.stack)
    }
  }
  if (componentStack) {
    lines.push('componentStack:')
    lines.push(componentStack)
  }
  lines.push('')
  lines.push('--- last crash log entries ---')
  for (const e of entries) {
    lines.push(
      `[${new Date(e.ts).toISOString()}] ${e.kind}${e.boundary ? ` <${e.boundary}>` : ''}${e.channel ? ` {${e.channel}}` : ''}: ${e.message ?? ''}`
    )
    if (e.stack) {
      lines.push(e.stack)
    }
  }
  return lines.join('\n')
}

let installed = false

/**
 * Install global window.error / unhandledrejection forwarders. Must run
 * before createRoot so a crash during initial module evaluation is still
 * captured. Safe to call multiple times.
 */
export function installGlobalRendererErrorHandlers(): void {
  if (installed) {
    return
  }
  installed = true

  window.addEventListener('error', (e) => {
    try {
      const error = e.error
      const message = error instanceof Error ? error.message : String(e.message ?? 'unknown error')
      const stack = error instanceof Error ? error.stack : undefined
      reportRendererCrash({ kind: 'window-error', message, stack })
    } catch {
      // Handler is the last line of defense — must never throw back into
      // the event loop.
    }
  })

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason
      const message =
        reason instanceof Error ? reason.message : String(reason ?? 'unknown rejection')
      const stack = reason instanceof Error ? reason.stack : undefined
      reportRendererCrash({ kind: 'unhandled-rejection', message, stack })
    } catch {
      // See above.
    }
  })
}

export type { RendererCrashKind }
