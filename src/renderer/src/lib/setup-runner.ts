export function buildSetupRunnerCommand(runnerScriptPath: string): string {
  if (navigator.userAgent.includes('Windows')) {
    return `cmd.exe /c ${quoteWindowsArg(runnerScriptPath)}`
  }

  return `bash ${quotePosixArg(runnerScriptPath)}`
}

function quotePosixArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
