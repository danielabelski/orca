/* eslint-disable max-lines -- Why: this file centralizes the macOS CLI install/remove boundary so PATH registration logic stays in one reviewed surface. */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { mkdir, lstat, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CliInstallStatus } from '../../shared/cli-install-types'

const execFileAsync = promisify(execFile)
const DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/orca'
const DEV_LAUNCHER_PATH = ['cli', 'bin', 'orca']

type CliInstallerOptions = {
  platform?: NodeJS.Platform
  isPackaged?: boolean
  userDataPath?: string
  resourcesPath?: string
  execPath?: string
  appPath?: string
  commandPathOverride?: string | null
  privilegedRunner?: (command: string) => Promise<void>
}

export class CliInstaller {
  private readonly platform: NodeJS.Platform
  private readonly isPackaged: boolean
  private readonly userDataPath: string
  private readonly resourcesPath: string
  private readonly execPathValue: string
  private readonly appPathValue: string
  private readonly commandPathOverride: string | null
  private readonly privilegedRunner: (command: string) => Promise<void>

  constructor(options: CliInstallerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.isPackaged = options.isPackaged ?? app.isPackaged
    this.userDataPath = options.userDataPath ?? app.getPath('userData')
    this.resourcesPath = options.resourcesPath ?? process.resourcesPath
    this.execPathValue = options.execPath ?? process.execPath
    this.appPathValue = options.appPath ?? app.getAppPath()
    this.commandPathOverride =
      options.commandPathOverride ?? process.env.ORCA_CLI_INSTALL_PATH ?? null
    this.privilegedRunner = options.privilegedRunner ?? runMacPrivilegedCommand
  }

  async getStatus(): Promise<CliInstallStatus> {
    if (this.platform !== 'darwin') {
      return {
        platform: this.platform,
        commandName: 'orca',
        commandPath: null,
        launcherPath: null,
        installMethod: null,
        supported: false,
        state: 'unsupported',
        currentTarget: null,
        unsupportedReason: 'platform_not_supported',
        detail: 'CLI registration is only implemented on macOS in this release.'
      }
    }

    const launcherPath = await this.resolveLauncherPath()
    const commandPath = this.resolveCommandPath()
    if (!launcherPath) {
      return {
        platform: this.platform,
        commandName: 'orca',
        commandPath,
        launcherPath: null,
        installMethod: 'symlink',
        supported: false,
        state: 'unsupported',
        currentTarget: null,
        unsupportedReason: this.isPackaged ? 'launcher_missing' : 'launch_mode_unavailable',
        detail: this.isPackaged
          ? 'The bundled CLI launcher is missing from this Orca build.'
          : 'Development mode uses a generated launcher for validation only.'
      }
    }

    return this.inspectLink(commandPath, launcherPath)
  }

  async install(): Promise<CliInstallStatus> {
    const status = await this.getStatus()
    if (!status.supported || !status.commandPath || !status.launcherPath) {
      throw new Error(status.detail ?? 'CLI registration is unavailable on this build.')
    }
    if (status.state === 'conflict') {
      throw new Error(`Refusing to replace non-symlink command at ${status.commandPath}.`)
    }

    await mkdir(dirname(status.commandPath), { recursive: true })
    try {
      if (status.state === 'installed') {
        return status
      }
      if (status.state === 'stale') {
        await unlink(status.commandPath)
      }
      await symlink(status.launcherPath, status.commandPath)
    } catch (error) {
      if (!isPermissionError(error)) {
        throw error
      }

      // Why: macOS shell-command registration should behave like VS Code and
      // place a stable symlink in /usr/local/bin instead of rewriting shell rc
      // files. Fallback to an elevated shell command keeps the public command
      // stable even when the app lacks direct write access to that directory.
      await this.privilegedRunner(
        `mkdir -p ${quoteShell(dirname(status.commandPath))} && ` +
          `ln -sfn ${quoteShell(status.launcherPath)} ${quoteShell(status.commandPath)}`
      )
    }

    return this.inspectLink(status.commandPath, status.launcherPath)
  }

  async remove(): Promise<CliInstallStatus> {
    const status = await this.getStatus()
    if (!status.supported || !status.commandPath || !status.launcherPath) {
      return status
    }
    if (status.state === 'not_installed') {
      return status
    }
    if (status.state === 'conflict') {
      throw new Error(`Refusing to remove non-symlink command at ${status.commandPath}.`)
    }
    if (status.state === 'stale') {
      throw new Error(`Refusing to remove a command not owned by Orca at ${status.commandPath}.`)
    }

    try {
      await unlink(status.commandPath)
    } catch (error) {
      if (!isPermissionError(error)) {
        throw error
      }
      await this.privilegedRunner(
        `if [ -L ${quoteShell(status.commandPath)} ]; then rm ${quoteShell(status.commandPath)}; fi`
      )
    }

    return this.inspectLink(status.commandPath, status.launcherPath)
  }

  private resolveCommandPath(): string {
    return this.commandPathOverride ?? DEFAULT_MAC_COMMAND_PATH
  }

  private async resolveLauncherPath(): Promise<string | null> {
    if (this.platform !== 'darwin') {
      return null
    }

    if (this.isPackaged) {
      const bundledPath = join(this.resourcesPath, 'bin', 'orca')
      return existsSync(bundledPath) ? bundledPath : null
    }

    return ensureDevLauncher({
      userDataPath: this.userDataPath,
      execPath: this.execPathValue,
      cliEntryPath: join(this.appPathValue, 'out', 'cli', 'index.js')
    })
  }

  private async inspectLink(commandPath: string, launcherPath: string): Promise<CliInstallStatus> {
    try {
      const stats = await lstat(commandPath)
      if (!stats.isSymbolicLink()) {
        return {
          platform: this.platform,
          commandName: 'orca',
          commandPath,
          launcherPath,
          installMethod: 'symlink',
          supported: true,
          state: 'conflict',
          currentTarget: null,
          unsupportedReason: null,
          detail: `${commandPath} exists but is not an Orca symlink.`
        }
      }

      const currentTarget = await readlink(commandPath)
      const resolvedCurrentTarget = resolve(dirname(commandPath), currentTarget)
      const resolvedLauncher = resolve(launcherPath)
      return {
        platform: this.platform,
        commandName: 'orca',
        commandPath,
        launcherPath,
        installMethod: 'symlink',
        supported: true,
        state: resolvedCurrentTarget === resolvedLauncher ? 'installed' : 'stale',
        currentTarget: resolvedCurrentTarget,
        unsupportedReason: null,
        detail:
          resolvedCurrentTarget === resolvedLauncher
            ? `Registered at ${commandPath}.`
            : `${commandPath} points to a different launcher.`
      }
    } catch (error) {
      if (isMissingError(error)) {
        return {
          platform: this.platform,
          commandName: 'orca',
          commandPath,
          launcherPath,
          installMethod: 'symlink',
          supported: true,
          state: 'not_installed',
          currentTarget: null,
          unsupportedReason: null,
          detail: `Register ${commandPath} to use Orca from Terminal.`
        }
      }
      throw error
    }
  }
}

async function ensureDevLauncher(args: {
  userDataPath: string
  execPath: string
  cliEntryPath: string
}): Promise<string | null> {
  if (
    !isAbsolute(args.execPath) ||
    !isAbsolute(args.cliEntryPath) ||
    !existsSync(args.cliEntryPath)
  ) {
    return null
  }

  const launcherPath = join(args.userDataPath, ...DEV_LAUNCHER_PATH)
  await mkdir(dirname(launcherPath), { recursive: true })

  // Why: packaged Orca will ship a launcher in Contents/Resources/bin, but
  // development builds do not have that stable asset layout. Generating a
  // launcher in userData lets us validate the shell-command flow without
  // changing the packaged registration contract.
  const content = `#!/usr/bin/env bash
set -euo pipefail
ELECTRON=${quoteShell(args.execPath)}
CLI=${quoteShell(args.cliEntryPath)}
export ORCA_NODE_OPTIONS="\${NODE_OPTIONS-}"
export ORCA_NODE_REPL_EXTERNAL_MODULE="\${NODE_REPL_EXTERNAL_MODULE-}"
unset NODE_OPTIONS
unset NODE_REPL_EXTERNAL_MODULE
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
`
  await writeFile(launcherPath, content, { encoding: 'utf8', mode: 0o755 })
  return launcherPath
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'EACCES' ||
      (error as NodeJS.ErrnoException).code === 'EPERM')
  )
}

function isMissingError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function runMacPrivilegedCommand(command: string): Promise<void> {
  await execFileAsync('osascript', [
    '-e',
    `do shell script ${quoteAppleScript(command)} with administrator privileges`
  ])
}

function quoteAppleScript(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function getBundledMacLauncherPath(resourcesPath: string): string {
  return join(resourcesPath, 'bin', 'orca')
}
