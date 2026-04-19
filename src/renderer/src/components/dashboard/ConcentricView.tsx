import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'
import type { DashboardRepoGroup } from './useDashboardData'
import RepoSystem, { stateColor } from './RepoSystem'

// Why: the dashboard renders in two places — embedded in the main window's
// right sidebar, and in a detached secondary window. The detached renderer
// has its own Zustand store, so calling setActiveWorktree there does nothing
// visible to the user. Detect that case so we can instead ask main to
// activate the worktree in the main window.
const IS_DETACHED_DASHBOARD =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'agent-dashboard'

export type TooltipBlock = { state: string; title: string }

export type TooltipData = {
  x: number
  y: number
  agentLabel: string
  state: string
  statusText?: string
  promptText?: string
  worktreeName: string
  blocks?: TooltipBlock[]
}

// Why: approximate height of the tooltip card. Used to decide whether to
// flip the tooltip below the cursor when there isn't enough room above
// (otherwise the card is clipped by the top of the viewport).
const TOOLTIP_FLIP_THRESHOLD_PX = 140

// Why: clamp zoom so we never invert the content or zoom so far that a single
// worktree ring fills the whole viewport and loses context.
const MIN_SCALE = 0.3
const MAX_SCALE = 4

// Why: WebKit-legacy gesture events aren't in lib.dom.d.ts but are dispatched
// by Chromium on macOS for trackpad pinches. Declaring the shape locally avoids
// casting through any while still keeping the event handlers type-safe.
type GestureEvent = Event & { scale: number; clientX: number; clientY: number }

// Why: pixels the cursor can move during a mousedown before we treat it as a
// pan instead of a click. Matches rough OS-level drag thresholds.
const DRAG_THRESHOLD_PX = 3

// ─── Transform Persistence ───────────────────────────────────────────────────
// Why: the concentric view unmounts when the user switches sidebar tabs or
// closes/reopens the dashboard window. A module-level variable survives the
// unmount so pan/zoom position is restored when the user returns.
let savedTransform: Transform = { x: 0, y: 0, scale: 1 }

type Transform = { x: number; y: number; scale: number }

type ConcentricViewProps = {
  groups: DashboardRepoGroup[]
  onCheckWorktree: (id: string) => void
}

export default function ConcentricView({ groups, onCheckWorktree }: ConcentricViewProps) {
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [transform, setTransform] = useState<Transform>(savedTransform)
  const [isPanning, setIsPanning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Why: ref copy of transform so wheel/mouse handlers attached via
  // addEventListener read the latest values without needing to re-register.
  const transformRef = useRef<Transform>(transform)
  transformRef.current = transform

  // Why: tracks whether the current mousedown has crossed the drag threshold.
  // Checked on click to suppress accidental worktree activation after a pan.
  const draggedRef = useRef(false)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // Persist transform across unmount.
  useEffect(() => {
    return () => {
      savedTransform = transformRef.current
    }
  }, [])

  // Why: attach wheel + WebKit gesture listeners via native addEventListener
  // with { passive: false } so we can preventDefault and stop the page (or
  // parent) from scrolling / zooming the whole web contents while the user
  // manipulates this canvas. React's synthetic wheel handler is always passive.
  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }

    const applyZoomAt = (clientX: number, clientY: number, zoomFactor: number): void => {
      const rect = el.getBoundingClientRect()
      const mouseX = clientX - rect.left
      const mouseY = clientY - rect.top
      const prev = transformRef.current
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * zoomFactor))
      const actualFactor = nextScale / prev.scale
      // Keep the point under the cursor stationary in screen space.
      const nextX = mouseX - (mouseX - prev.x) * actualFactor
      const nextY = mouseY - (mouseY - prev.y) * actualFactor
      setTransform({ x: nextX, y: nextY, scale: nextScale })
    }

    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      // Why: trackpad pinch-zoom in Chromium arrives as a wheel event with
      // small deltaY and ctrlKey=true; normal wheel scroll has larger deltaY
      // and no ctrlKey. Both should zoom here — we're a canvas, not a
      // scrollable page. Pinch gets higher sensitivity so a natural gesture
      // produces perceptible zoom instead of crawling.
      const sensitivity = e.ctrlKey ? 0.02 : 0.0015
      const zoomFactor = Math.exp(-e.deltaY * sensitivity)
      applyZoomAt(e.clientX, e.clientY, zoomFactor)
    }

    // Why: on macOS, Electron/Chromium doesn't always synthesize pinch into
    // ctrlKey-wheel events — especially in windows where visualZoomLevelLimits
    // hasn't been configured. WebKit-legacy GestureEvents (gesturestart /
    // gesturechange / gestureend) are still dispatched to the DOM for trackpad
    // pinch and carry a `scale` property representing cumulative zoom relative
    // to the gesture's start. Tracking the delta between successive scale
    // readings lets us zoom even when the wheel path is silent.
    let prevScale = 1
    let anchorX = 0
    let anchorY = 0
    const handleGestureStart = (e: Event): void => {
      e.preventDefault()
      const ge = e as GestureEvent
      prevScale = 1
      anchorX = ge.clientX
      anchorY = ge.clientY
    }
    const handleGestureChange = (e: Event): void => {
      e.preventDefault()
      const ge = e as GestureEvent
      const delta = ge.scale / prevScale
      prevScale = ge.scale
      if (!Number.isFinite(delta) || delta <= 0) {
        return
      }
      applyZoomAt(ge.clientX || anchorX, ge.clientY || anchorY, delta)
    }
    const handleGestureEnd = (e: Event): void => {
      e.preventDefault()
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('gesturestart', handleGestureStart, { passive: false })
    el.addEventListener('gesturechange', handleGestureChange, { passive: false })
    el.addEventListener('gestureend', handleGestureEnd, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('gesturestart', handleGestureStart)
      el.removeEventListener('gesturechange', handleGestureChange)
      el.removeEventListener('gestureend', handleGestureEnd)
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left-button drags initiate a pan.
    if (e.button !== 0) {
      return
    }
    const prev = transformRef.current
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: prev.x,
      ty: prev.y
    }
    draggedRef.current = false
    setIsPanning(true)
  }, [])

  useEffect(() => {
    if (!isPanning) {
      return
    }
    const handleMove = (e: MouseEvent): void => {
      const start = panStartRef.current
      if (!start) {
        return
      }
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (
        !draggedRef.current &&
        (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)
      ) {
        draggedRef.current = true
        // Why: hide any hover tooltip once a pan begins — it would stay
        // frozen at its last screen position while the content moves.
        setTooltip(null)
      }
      if (draggedRef.current) {
        setTransform((curr) => ({ ...curr, x: start.tx + dx, y: start.ty + dy }))
      }
    }
    const handleUp = (): void => {
      panStartRef.current = null
      setIsPanning(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isPanning])

  const handleClick = useCallback(
    (worktreeId: string) => {
      // Why: a drag that crossed the threshold should not also count as a
      // click on the worktree underneath. onMouseUp fires before onClick, so
      // draggedRef is already set by this point.
      if (draggedRef.current) {
        return
      }
      // Why: clicking a tile — regardless of its state — only navigates to the
      // terminal. Dismissal of "done" agents is an explicit action on the X
      // button (see onDismiss) so users can click through to review a finished
      // agent without losing it from the dashboard.
      if (IS_DETACHED_DASHBOARD) {
        // Detached window cannot mutate the main window's store directly;
        // route through main so the main window receives the existing
        // ui:activateWorktree event and focuses itself.
        void window.api.ui.requestActivateWorktree({
          repoId: getRepoIdFromWorktreeId(worktreeId),
          worktreeId
        })
        return
      }
      setActiveWorktree(worktreeId)
      setActiveView('terminal')
    },
    [setActiveWorktree, setActiveView]
  )

  const handleDismiss = useCallback(
    (worktreeId: string) => {
      if (draggedRef.current) {
        return
      }
      onCheckWorktree(worktreeId)
    },
    [onCheckWorktree]
  )

  const showTooltip = useCallback((e: React.MouseEvent, data: Omit<TooltipData, 'x' | 'y'>) => {
    // Why: while the user is actively panning, swallow tooltip updates so
    // the card doesn't flicker under the moving cursor.
    if (draggedRef.current) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const rect = container.getBoundingClientRect()
    // Tooltip lives outside the transformed layer, so we store container-
    // relative screen coords — no scroll or scale correction needed.
    setTooltip({
      ...data,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
  }, [])

  const containerRect = containerRef.current?.getBoundingClientRect()
  // Why: tooltip renders above the cursor by default. If the cursor is too
  // close to the top of the container, the tooltip gets clipped. Flip it
  // below the cursor in that case.
  const flipBelow = tooltip !== null && tooltip.y - TOOLTIP_FLIP_THRESHOLD_PX < 0

  const hideTooltip = useCallback(() => setTooltip(null), [])

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [])

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
        No visible agents.
      </div>
    )
  }

  const isTransformed = transform.x !== 0 || transform.y !== 0 || transform.scale !== 1

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => {
        // Why: double-click on empty canvas resets the view. Skip when the
        // double-click landed on an SVG element so double-tapping a worktree
        // still goes through the worktree's own handlers.
        const node = e.target as Element | null
        if (node && node.closest('svg')) {
          return
        }
        resetView()
      }}
    >
      {/* Transformed content layer — pan/zoom is applied here.
          Width matches the container so items-center still centers repos
          horizontally at scale=1, preserving the original layout. */}
      <div
        className="absolute left-0 top-0 w-full origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          // Why: disable transition while actively panning so motion tracks
          // the cursor 1:1. Leave a short ease on wheel-driven zoom commits
          // only when NOT panning for a subtle polish.
          transition: isPanning ? 'none' : 'transform 60ms ease-out',
          willChange: 'transform'
        }}
      >
        <div className="flex flex-col items-center gap-1 py-2">
          {groups.map((group) => (
            <RepoSystem
              key={group.repo.id}
              group={group}
              onClick={handleClick}
              onDismiss={handleDismiss}
              onShowTooltip={showTooltip}
              onHideTooltip={hideTooltip}
            />
          ))}
        </div>
      </div>

      {/* Zoom controls — floating in the corner, outside the transform. */}
      <div className="pointer-events-none absolute right-2 top-2 z-40 flex items-center gap-1">
        <div className="rounded-md border border-border/40 bg-popover/80 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
          {Math.round(transform.scale * 100)}%
        </div>
        {isTransformed && (
          <button
            type="button"
            onClick={resetView}
            className="pointer-events-auto flex items-center justify-center rounded-md border border-border/40 bg-popover/80 p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
            aria-label="Reset view"
            title="Reset view (or double-click empty space)"
          >
            <Maximize2 size={11} />
          </button>
        )}
      </div>

      {/* Floating tooltip overlay — shows per-agent detail on hover.
          Rendered outside the transformed layer so it stays screen-space. */}
      {tooltip && containerRect && (
        <div
          className="pointer-events-none absolute z-50 max-w-[220px] rounded-lg border border-border/50 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-sm"
          style={{
            // Why: clamp horizontal position so the tooltip (centered on x via
            // transform) never extends past the edges of the container.
            left: Math.min(Math.max(tooltip.x, 112), Math.max(112, containerRect.width - 112)),
            top: flipBelow ? tooltip.y + 18 : tooltip.y - 12,
            transform: flipBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
          }}
        >
          {/* Agent identity + state */}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-[6px] shrink-0 rounded-full"
              style={{ backgroundColor: stateColor(tooltip.state).fill }}
            />
            <span className="text-[11px] font-semibold text-foreground">{tooltip.agentLabel}</span>
            <span
              className="text-[10px] font-medium"
              style={{ color: stateColor(tooltip.state).fill }}
            >
              {tooltip.state.charAt(0).toUpperCase() + tooltip.state.slice(1)}
            </span>
          </div>

          {/* Worktree context */}
          <div className="mt-0.5 text-[9px] text-muted-foreground/50">{tooltip.worktreeName}</div>
          {tooltip.blocks && tooltip.blocks.length > 0 ? (
            <div className="mt-1.5 flex items-center gap-0.5">
              {tooltip.blocks.map((block, i) => (
                <span
                  key={`${i}-${block.state}`}
                  title={block.title}
                  className="h-1.5 w-3 rounded-sm"
                  style={{ backgroundColor: stateColor(block.state).fill, opacity: 0.75 }}
                />
              ))}
            </div>
          ) : null}
          {tooltip.promptText ? (
            <div className="mt-1 max-w-[220px] text-[10px] leading-snug text-muted-foreground/80">
              Prompt: {tooltip.promptText}
            </div>
          ) : null}
          {tooltip.statusText ? (
            <div className="mt-1 max-w-[220px] text-[10px] leading-snug text-muted-foreground/65">
              {tooltip.statusText}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
