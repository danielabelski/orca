# Mermaid File Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `.mmd` / `.mermaid` files and render them as live, themed diagrams with a source/diagram toggle in the editor header.

**Architecture:** Orca already has a `MermaidBlock` component that renders mermaid syntax to SVG, and a `MarkdownViewToggle` that switches between source and rich modes. This plan registers `.mmd`/`.mermaid` as a new language (`'mermaid'`), adds a `MermaidViewer` component that wraps `MermaidBlock` for full-file rendering with scroll caching and centering, and wires it into the existing `EditorPanel` / `EditorContent` routing alongside the markdown path. The view mode store (`markdownViewMode`) is reused since it is already keyed by file ID.

**Tech Stack:** React, Zustand (existing store), mermaid (already installed v11.14), DOMPurify (already installed), Monaco (source mode), existing `MermaidBlock` component.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/renderer/src/lib/language-detect.ts` | Register `.mmd` and `.mermaid` extensions |
| Create | `src/renderer/src/components/editor/MermaidViewer.tsx` | Full-file mermaid diagram viewer with scroll caching |
| Modify | `src/renderer/src/components/editor/EditorPanel.tsx` | Add `isMermaid` flag, show view toggle for mermaid files |
| Modify | `src/renderer/src/components/editor/EditorContent.tsx` | Add `isMermaid` prop, route to `MermaidViewer` or Monaco |
| Modify | `src/renderer/src/assets/markdown-preview.css` | Add `.mermaid-viewer` styles |

---

### Task 1: Register `.mmd` and `.mermaid` file extensions

**Files:**
- Modify: `src/renderer/src/lib/language-detect.ts:10-76` (add two entries to `EXT_TO_LANGUAGE`)

- [ ] **Step 1: Add mermaid extensions to the language map**

In `src/renderer/src/lib/language-detect.ts`, add these two entries to the `EXT_TO_LANGUAGE` object (between `.mdx` and `.css`):

```typescript
'.mmd': 'mermaid',
'.mermaid': 'mermaid',
```

- [ ] **Step 2: Verify the change compiles**

Run: `cd src/renderer && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `language-detect.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/language-detect.ts
git commit -m "feat: register .mmd and .mermaid file extensions"
```

---

### Task 2: Create `MermaidViewer` component

**Files:**
- Create: `src/renderer/src/components/editor/MermaidViewer.tsx`

This component renders the entire file content as a mermaid diagram. It reuses the existing `MermaidBlock` for rendering and follows the same dark-mode detection and scroll-caching patterns as `MarkdownPreview`.

- [ ] **Step 1: Create the `MermaidViewer` component**

Create `src/renderer/src/components/editor/MermaidViewer.tsx`:

```tsx
import React, { useLayoutEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import MermaidBlock from './MermaidBlock'

type MermaidViewerProps = {
  content: string
  filePath: string
}

// Why: MermaidViewer is the full-file counterpart to MermaidBlock (which
// renders fenced mermaid blocks inside markdown). When a user opens a .mmd
// or .mermaid file in diagram mode, the entire file content is the diagram
// source — no markdown wrapper, no frontmatter, just mermaid syntax.
export default function MermaidViewer({
  content,
  filePath
}: MermaidViewerProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const settings = useAppStore((s) => s.settings)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Why: Each viewing mode (source vs diagram) produces different DOM heights.
  // Mode-scoped keys prevent restoring a source-mode scroll position in diagram
  // mode (same reasoning as MarkdownPreview's scrollCacheKey).
  const scrollCacheKey = `${filePath}:mermaid-diagram`

  useLayoutEffect(() => {
    const container = rootRef.current
    if (!container) {
      return
    }

    let throttleTimer: ReturnType<typeof setTimeout> | null = null

    const onScroll = (): void => {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer)
      }
      throttleTimer = setTimeout(() => {
        setWithLRU(scrollTopCache, scrollCacheKey, container.scrollTop)
        throttleTimer = null
      }, 150)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      setWithLRU(scrollTopCache, scrollCacheKey, container.scrollTop)
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer)
      }
      container.removeEventListener('scroll', onScroll)
    }
  }, [scrollCacheKey])

  useLayoutEffect(() => {
    const container = rootRef.current
    const targetScrollTop = scrollTopCache.get(scrollCacheKey)
    if (!container || targetScrollTop === undefined) {
      return
    }

    let frameId = 0
    let attempts = 0

    // Why: mermaid.render() is async, so the SVG may not exist on the first
    // frame. Retry up to 30 frames (~500ms) to match MarkdownPreview's pattern.
    const tryRestore = (): void => {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const nextScrollTop = Math.min(targetScrollTop, maxScrollTop)
      container.scrollTop = nextScrollTop

      if (Math.abs(container.scrollTop - targetScrollTop) <= 1 || maxScrollTop >= targetScrollTop) {
        return
      }

      attempts += 1
      if (attempts < 30) {
        frameId = window.requestAnimationFrame(tryRestore)
      }
    }

    tryRestore()
    return () => window.cancelAnimationFrame(frameId)
  }, [scrollCacheKey, content])

  return (
    <div
      ref={rootRef}
      className="mermaid-viewer h-full min-h-0 overflow-auto scrollbar-editor"
    >
      <div className="mermaid-viewer-canvas">
        <MermaidBlock content={content.trim()} isDark={isDark} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src/renderer && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/editor/MermaidViewer.tsx
git commit -m "feat: add MermaidViewer component for .mmd file rendering"
```

---

### Task 3: Add `.mermaid-viewer` styles

**Files:**
- Modify: `src/renderer/src/assets/markdown-preview.css` (append after existing `.mermaid-error` block, around line 242)

- [ ] **Step 1: Add viewer styles**

Append after the `.mermaid-error` rule block (line ~242) in `markdown-preview.css`:

```css
/* Full-file mermaid diagram viewer — used when opening .mmd/.mermaid files
   in diagram mode. Centers the rendered SVG and adds padding so diagrams
   don't press against viewport edges. */
.mermaid-viewer {
  background: var(--color-background, #fff);
}
.mermaid-viewer-canvas {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100%;
  padding: 32px 24px;
}
.mermaid-viewer-canvas .mermaid-block {
  max-width: 100%;
}
.mermaid-viewer-canvas .mermaid-block svg {
  max-width: 100%;
  height: auto;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/markdown-preview.css
git commit -m "feat: add mermaid-viewer CSS for full-file diagram display"
```

---

### Task 4: Wire mermaid files into `EditorPanel` and `EditorContent`

**Files:**
- Modify: `src/renderer/src/components/editor/EditorPanel.tsx:427-519`
- Modify: `src/renderer/src/components/editor/EditorContent.tsx:1-67,262-270`

This task threads the `isMermaid` flag through the same path as `isMarkdown`, reusing the existing `markdownViewMode` store (keyed by file ID, so no collision) and `MarkdownViewToggle` (icon-only, works for both).

- [ ] **Step 1: Update `EditorPanel.tsx`**

**Change 1** — add `isMermaid` flag and widen the view-mode condition (around line 427):

Replace:
```typescript
  const isMarkdown = resolvedLanguage === 'markdown'
  const mdViewMode: MarkdownViewMode =
    isMarkdown && activeFile.mode === 'edit'
      ? (markdownViewMode[activeFile.id] ?? 'rich')
      : 'source'
```

With:
```typescript
  const isMarkdown = resolvedLanguage === 'markdown'
  const isMermaid = resolvedLanguage === 'mermaid'
  // Why: mermaid files reuse the same per-file view mode store as markdown.
  // Both default to 'rich' (rendered view) and fall back to 'source' (Monaco).
  const hasViewModeToggle = (isMarkdown || isMermaid) && activeFile.mode === 'edit'
  const mdViewMode: MarkdownViewMode = hasViewModeToggle
    ? (markdownViewMode[activeFile.id] ?? 'rich')
    : 'source'
```

**Change 2** — update the toggle condition in the header (around line 515):

Replace:
```tsx
          {isMarkdown && activeFile.mode === 'edit' && (
            <MarkdownViewToggle
```

With:
```tsx
          {hasViewModeToggle && (
            <MarkdownViewToggle
```

**Change 3** — pass `isMermaid` to `EditorContent` (around line 531):

Add `isMermaid={isMermaid}` after the `isMarkdown` prop:

```tsx
          isMarkdown={isMarkdown}
          isMermaid={isMermaid}
```

- [ ] **Step 2: Update `EditorContent.tsx`**

**Change 1** — add lazy import for `MermaidViewer` (after the `ImageDiffViewer` lazy import, around line 18):

```typescript
const MermaidViewer = lazy(() => import('./MermaidViewer'))
```

**Change 2** — add `isMermaid` to the component props type and destructuring (around line 34-67):

Add `isMermaid: boolean` to the props type (after `isMarkdown: boolean`), and add `isMermaid` to the destructuring.

**Change 3** — add mermaid routing in the edit-mode branch (around line 266):

Replace:
```tsx
          {isMarkdown ? renderMarkdownContent(fc) : renderMonacoEditor(fc)}
```

With:
```tsx
          {isMarkdown
            ? renderMarkdownContent(fc)
            : isMermaid && mdViewMode === 'rich'
              ? <MermaidViewer
                  key={activeFile.id}
                  content={editBuffers[activeFile.id] ?? fc.content}
                  filePath={activeFile.filePath}
                />
              : renderMonacoEditor(fc)}
```

- [ ] **Step 3: Verify everything compiles**

Run: `cd src/renderer && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/editor/EditorPanel.tsx src/renderer/src/components/editor/EditorContent.tsx
git commit -m "feat: wire mermaid file viewer into editor panel routing"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Create a test `.mmd` file in any worktree**

Place a file like `test-diagram.mmd` in a worktree directory with content:

```
graph TD
    A[Open .mmd file] --> B{Rendered?}
    B -->|Yes| C[Diagram view]
    B -->|No| D[Source view]
    C --> E[Toggle to source]
    D --> F[Toggle to diagram]
```

- [ ] **Step 2: Open the file in Orca and verify**

Check:
1. File opens in diagram mode by default (rendered SVG, centered)
2. Source/diagram toggle appears in the editor header
3. Clicking the Code icon switches to Monaco with mermaid syntax
4. Clicking the Eye icon switches back to the rendered diagram
5. Dark mode: diagram respects the current theme
6. Large diagrams scroll properly
7. Scroll position is preserved when switching tabs and back

- [ ] **Step 3: Verify no regressions**

Check:
1. Opening a `.md` file still works with source/rich toggle
2. Mermaid fenced blocks inside `.md` files still render
3. Non-markdown, non-mermaid files open normally in Monaco

- [ ] **Step 4: Clean up the test file and commit everything**

```bash
rm test-diagram.mmd
```
