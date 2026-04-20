/// <reference types="vite/client" />

import type { editor } from 'monaco-editor'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'

declare global {
  var MonacoEnvironment:
    | {
        getWorker(workerId: string, label: string): Worker
      }
    | undefined
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __paneManagers?: Map<string, PaneManager>
    // Why: MonacoEditor.tsx exposes the live editor instances in dev/E2E keyed
    // by viewStateKey (one entry per mounted pane, unique even when split panes
    // view the same file). Declared here so the renderer can read/write the
    // registry without casting through `unknown`, and so a future shape change
    // is caught at compile time. The test harness mirrors this augmentation in
    // tests/e2e/helpers/runtime-types.ts for its own tsconfig.
    __monacoEditors?: Map<string, editor.IStandaloneCodeEditor>
  }
}

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
interface ImportMetaEnv {
  readonly VITE_EXPOSE_STORE?: boolean
}

export {}
