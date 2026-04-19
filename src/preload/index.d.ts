import type { ElectronAPI } from '@electron-toolkit/preload'
import type { PreloadApi } from './api-types'

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    electron: ElectronAPI
    api: PreloadApi
  }
}

export {}
