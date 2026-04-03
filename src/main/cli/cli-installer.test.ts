import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from './cli-installer'

async function makeFixture(): Promise<{
  root: string
  userDataPath: string
  appPath: string
  installPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-cli-installer-'))
  const userDataPath = join(root, 'userData')
  const appPath = join(root, 'app')
  const cliEntryPath = join(appPath, 'out', 'cli', 'index.js')
  const installPath = join(root, 'bin', 'orca')
  await mkdir(join(appPath, 'out', 'cli'), { recursive: true })
  await writeFile(cliEntryPath, 'console.log("orca")\n', 'utf8')
  return { root, userDataPath, appPath, installPath }
}

describe('CliInstaller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports unsupported on non-mac platforms', async () => {
    const installer = new CliInstaller({ platform: 'linux' })
    await expect(installer.getStatus()).resolves.toMatchObject({
      supported: false,
      state: 'unsupported',
      unsupportedReason: 'platform_not_supported'
    })
  })

  it('creates a dev launcher and installs a symlink in the requested path', async () => {
    const fixture = await makeFixture()
    const installer = new CliInstaller({
      platform: 'darwin',
      isPackaged: false,
      userDataPath: fixture.userDataPath,
      execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
      appPath: fixture.appPath,
      commandPathOverride: fixture.installPath
    })

    const initial = await installer.getStatus()
    expect(initial.state).toBe('not_installed')
    expect(initial.launcherPath).toContain(join('userData', 'cli', 'bin', 'orca'))

    const installed = await installer.install()
    expect(installed.state).toBe('installed')

    const launcherContent = await readFile(installed.launcherPath as string, 'utf8')
    expect(launcherContent).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(launcherContent).toContain(join(fixture.appPath, 'out', 'cli', 'index.js'))

    const removed = await installer.remove()
    expect(removed.state).toBe('not_installed')
  })

  it('reports stale when a different symlink already exists', async () => {
    const fixture = await makeFixture()
    await mkdir(join(fixture.root, 'bin'), { recursive: true })
    await symlink('/tmp/not-orca', fixture.installPath)

    const installer = new CliInstaller({
      platform: 'darwin',
      isPackaged: false,
      userDataPath: fixture.userDataPath,
      execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
      appPath: fixture.appPath,
      commandPathOverride: fixture.installPath
    })

    await expect(installer.getStatus()).resolves.toMatchObject({
      state: 'stale',
      supported: true
    })
  })
})
