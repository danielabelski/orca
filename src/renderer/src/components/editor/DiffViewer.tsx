import React, { useState, useCallback, useRef } from 'react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { Columns2, Rows2 } from 'lucide-react'
import { useAppStore } from '@/store'
import '@/lib/monaco-setup'

type DiffViewerProps = {
  originalContent: string
  modifiedContent: string
  language: string
  filePath: string
  editable?: boolean
  onContentChange?: (content: string) => void
  onSave?: (content: string) => void
}

export default function DiffViewer({
  originalContent,
  modifiedContent,
  language,
  filePath,
  editable,
  onContentChange,
  onSave
}: DiffViewerProps): React.JSX.Element {
  const [sideBySide, setSideBySide] = useState(true)
  const settings = useAppStore((s) => s.settings)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Keep refs to latest callbacks so the mounted editor always calls current versions
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      if (editable) {
        const modifiedEditor = editor.getModifiedEditor()

        // Cmd/Ctrl+S to save
        modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSaveRef.current?.(modifiedEditor.getValue())
        })

        // Track changes
        modifiedEditor.onDidChangeModelContent(() => {
          onContentChangeRef.current?.(modifiedEditor.getValue())
        })

        modifiedEditor.focus()
      } else {
        editor.focus()
      }
    },
    [editable]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background/50">
        <span className="text-xs text-muted-foreground truncate">{filePath}</span>
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setSideBySide((prev) => !prev)}
          title={sideBySide ? 'Switch to inline diff' : 'Switch to side-by-side diff'}
        >
          {sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}
        </button>
      </div>

      {/* Diff Editor */}
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          language={language}
          original={originalContent}
          modified={modifiedContent}
          theme={isDark ? 'vs-dark' : 'vs'}
          onMount={handleMount}
          options={{
            readOnly: !editable,
            originalEditable: false,
            renderSideBySide: sideBySide,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: settings?.terminalFontSize ?? 13,
            fontFamily: settings?.terminalFontFamily || 'monospace',
            lineNumbers: 'on',
            automaticLayout: true,
            renderOverviewRuler: true,
            padding: { top: 8 }
          }}
        />
      </div>
    </div>
  )
}
