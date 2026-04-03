export type CliInstallState = 'installed' | 'not_installed' | 'stale' | 'conflict' | 'unsupported'

export type CliInstallUnsupportedReason =
  | 'platform_not_supported'
  | 'launcher_missing'
  | 'launch_mode_unavailable'

export type CliInstallMethod = 'symlink'

export type CliInstallStatus = {
  platform: NodeJS.Platform
  commandName: string
  commandPath: string | null
  launcherPath: string | null
  installMethod: CliInstallMethod | null
  supported: boolean
  state: CliInstallState
  currentTarget: string | null
  unsupportedReason: CliInstallUnsupportedReason | null
  detail: string | null
}
