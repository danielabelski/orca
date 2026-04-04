import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { exec, execFileSync } from 'child_process'
import { getDefaultRepoHookSettings } from '../shared/constants'
import type {
  OrcaHooks,
  Repo,
  SetupDecision,
  SetupRunPolicy,
  WorktreeSetupLaunch
} from '../shared/types'

const HOOK_TIMEOUT = 120_000 // 2 minutes

function getHookShell(): string | undefined {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe'
  }

  return '/bin/bash'
}

/**
 * Parse a simple orca.yaml file. Handles only the `scripts:` block with
 * multiline string values (YAML block scalar `|`).
 */
export function parseOrcaYaml(content: string): OrcaHooks | null {
  const hooks: OrcaHooks = { scripts: {} }

  // Match top-level "scripts:" block
  const scriptsMatch = content.match(/^scripts:\s*$/m)
  if (!scriptsMatch) {
    return null
  }

  const afterScripts = content.slice(scriptsMatch.index! + scriptsMatch[0].length)
  // [Fix]: Split using /\r?\n/ instead of '\n'. Otherwise, on Windows, trailing \r characters
  // stay attached to script commands, which causes fatal '\r command not found' errors in WSL/bash.
  const lines = afterScripts.split(/\r?\n/)

  let currentKey: 'setup' | 'archive' | null = null
  let currentValue = ''

  for (const line of lines) {
    // Another top-level key (not indented) — stop parsing scripts block
    if (/^\S/.test(line) && line.trim().length > 0) {
      break
    }

    // Indented key like "  setup: |" or "  archive: |" or "  setup: echo hello"
    const keyMatch = line.match(/^  (setup|archive):\s*(\|)?\s*(.*)$/)
    if (keyMatch) {
      // Save previous key
      if (currentKey) {
        hooks.scripts[currentKey] = currentValue.trimEnd()
      }
      currentKey = keyMatch[1] as 'setup' | 'archive'
      currentValue = keyMatch[3] ? `${keyMatch[3]}\n` : ''
      continue
    }

    // Content line (indented by 4+ spaces under a key)
    if (currentKey && line.startsWith('    ')) {
      currentValue += `${line.slice(4)}\n`
    }
  }

  // Save last key
  if (currentKey) {
    hooks.scripts[currentKey] = currentValue.trimEnd()
  }

  if (!hooks.scripts.setup && !hooks.scripts.archive) {
    return null
  }
  return hooks
}

/**
 * Load hooks from orca.yaml in the given repo root.
 */
export function loadHooks(repoPath: string): OrcaHooks | null {
  const yamlPath = join(repoPath, 'orca.yaml')
  if (!existsSync(yamlPath)) {
    return null
  }

  try {
    const content = readFileSync(yamlPath, 'utf-8')
    return parseOrcaYaml(content)
  } catch {
    return null
  }
}

/**
 * Check whether an orca.yaml exists for a repo.
 */
export function hasHooksFile(repoPath: string): boolean {
  return existsSync(join(repoPath, 'orca.yaml'))
}

export function getEffectiveHooks(repo: Repo): OrcaHooks | null {
  const yamlHooks = loadHooks(repo.path)
  const legacySetup = repo.hookSettings?.scripts.setup?.trim()
  const legacyArchive = repo.hookSettings?.scripts.archive?.trim()
  const setup = yamlHooks?.scripts.setup?.trim() || legacySetup
  const archive = yamlHooks?.scripts.archive?.trim() || legacyArchive

  if (!setup && !archive) {
    return null
  }

  // Why: `orca.yaml` is the preferred source going forward, but existing users may
  // still have setup/archive commands persisted only in repo settings. Resolve each
  // hook independently so a repo that has only migrated one command into `orca.yaml`
  // does not silently lose the other legacy hook until the migration is complete.
  return {
    scripts: {
      ...(setup ? { setup } : {}),
      ...(archive ? { archive } : {})
    }
  }
}

export function getEffectiveSetupRunPolicy(repo: Repo): SetupRunPolicy {
  return repo.hookSettings?.setupRunPolicy ?? getDefaultRepoHookSettings().setupRunPolicy!
}

export function shouldRunSetupForCreate(repo: Repo, decision: SetupDecision = 'inherit'): boolean {
  if (decision === 'run') {
    return true
  }
  if (decision === 'skip') {
    return false
  }

  const policy = getEffectiveSetupRunPolicy(repo)
  if (policy === 'ask') {
    throw new Error('Setup decision required for this repository')
  }

  return policy === 'run-by-default'
}

export function getSetupCommandSource(repo: Repo): { source: 'yaml'; command: string } | null {
  const yamlSetup = loadHooks(repo.path)?.scripts.setup?.trim()

  if (yamlSetup) {
    return { source: 'yaml', command: yamlSetup }
  }

  return null
}

function getSetupEnvVars(repo: Repo, worktreePath: string): Record<string, string> {
  return {
    ORCA_ROOT_PATH: repo.path,
    ORCA_WORKTREE_PATH: worktreePath,
    // Compat with conductor.json users
    CONDUCTOR_ROOT_PATH: repo.path,
    GHOSTX_ROOT_PATH: repo.path
  }
}

function getGitPath(cwd: string, relativePath: string): string {
  return execFileSync('git', ['rev-parse', '--git-path', relativePath], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim()
}

function buildWindowsRunnerScript(script: string): string {
  const lines = script.replace(/\r?\n/g, '\n').split('\n')
  const runnerLines = ['@echo off', 'setlocal EnableExtensions']

  for (const rawLine of lines) {
    const command = rawLine.trim()
    if (!command) {
      runnerLines.push('')
      continue
    }

    // Why: setup commands often invoke `npm`/`pnpm`, which are batch files on
    // Windows. Calling one batch file from another without `call` never returns
    // to later lines, and plain newline-separated commands also keep running
    // after failures. Wrap each line in `call` and bail on non-zero exit codes
    // so the generated runner matches the fail-fast behavior of `set -e`.
    runnerLines.push(`call ${command}`)
    runnerLines.push('if errorlevel 1 exit /b %errorlevel%')
  }

  return `${runnerLines.join('\r\n')}\r\n`
}

export function createSetupRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string
): WorktreeSetupLaunch {
  const envVars = getSetupEnvVars(repo, worktreePath)
  const isWindows = process.platform === 'win32'
  const normalizedScript = isWindows
    ? script.replace(/\r?\n/g, '\r\n')
    : script.replace(/\r\n/g, '\n')
  // Why: linked git worktrees use a `.git` file that points at the real gitdir,
  // so writing under `${worktreePath}/.git/...` fails. `git rev-parse --git-path`
  // resolves the actual per-worktree git storage path safely across platforms.
  const runnerScriptPath = getGitPath(
    worktreePath,
    isWindows ? 'orca/setup-runner.cmd' : 'orca/setup-runner.sh'
  )

  mkdirSync(dirname(runnerScriptPath), { recursive: true })

  if (isWindows) {
    writeFileSync(runnerScriptPath, buildWindowsRunnerScript(normalizedScript), 'utf-8')
  } else {
    writeFileSync(runnerScriptPath, `#!/usr/bin/env bash\nset -e\n${normalizedScript}\n`, 'utf-8')
    chmodSync(runnerScriptPath, 0o755)
  }

  return { runnerScriptPath, envVars }
}

/**
 * Run a named hook script in the given working directory.
 */
export function runHook(
  hookName: 'setup' | 'archive',
  cwd: string,
  repo: Repo
): Promise<{ success: boolean; output: string }> {
  const hooks = getEffectiveHooks(repo)
  const script = hooks?.scripts[hookName]

  if (!script) {
    return Promise.resolve({ success: true, output: '' })
  }

  return new Promise((resolve) => {
    exec(
      script,
      {
        cwd,
        timeout: HOOK_TIMEOUT,
        shell: getHookShell(),
        env: {
          ...process.env,
          ...getSetupEnvVars(repo, cwd)
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error(`[hooks] ${hookName} hook failed in ${cwd}:`, error.message)
          resolve({
            success: false,
            output: `${stdout}\n${stderr}\n${error.message}`.trim()
          })
        } else {
          console.log(`[hooks] ${hookName} hook completed in ${cwd}`)
          resolve({
            success: true,
            output: `${stdout}\n${stderr}`.trim()
          })
        }
      }
    )
  })
}
