import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'

export function writeFileAtomically(
  targetPath: string,
  contents: string,
  options?: { mode?: number }
): void {
  const tmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: options?.mode })
    renameWithRetry(tmpPath, targetPath)
  } catch (error) {
    rmSync(tmpPath, { force: true })
    throw error
  }
}

// Why: on Windows, renameSync can fail with EPERM/EACCES if another process
// (antivirus, Codex CLI) holds the target file open. A short retry avoids
// transient failures without masking real permission errors.
function renameWithRetry(source: string, target: string): void {
  const maxAttempts = process.platform === 'win32' ? 3 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt < maxAttempts && (code === 'EPERM' || code === 'EACCES')) {
        const delayMs = attempt * 50
        const until = Date.now() + delayMs
        while (Date.now() < until) {
          /* busy-wait: setTimeout is async and callers must stay sync */
        }
        continue
      }
      throw error
    }
  }
}
