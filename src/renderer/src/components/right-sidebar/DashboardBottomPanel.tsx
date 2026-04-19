import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, PanelTopOpen } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { countWorkingAgents } from '../../lib/agent-status'
import AgentDashboard from '../dashboard/AgentDashboard'

const MIN_HEIGHT = 120
const DEFAULT_HEIGHT = 240
const HEADER_HEIGHT = 30
const STORAGE_KEY = 'orca.dashboardSidebarPanel'

type PersistedState = {
  height: number
  collapsed: boolean
}

function loadPersistedState(): PersistedState {
  if (typeof window === 'undefined') {
    return { height: DEFAULT_HEIGHT, collapsed: false }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { height: DEFAULT_HEIGHT, collapsed: false }
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      height: typeof parsed.height === 'number' ? parsed.height : DEFAULT_HEIGHT,
      collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : false
    }
  } catch {
    return { height: DEFAULT_HEIGHT, collapsed: false }
  }
}

// Why: a persistent bottom section of the right sidebar that always shows the
// AgentDashboard, independent of which activity tab the user has open. Users
// drag the top edge to resize upward (within the available sidebar height)
// and can fully collapse to a single row. The pop-out button reuses the
// existing detached-window flow from window.api.ui.openAgentDashboard().
export default function DashboardBottomPanel(): React.JSX.Element {
  const initial = useMemo(loadPersistedState, [])
  const [height, setHeight] = useState<number>(initial.height)
  const [collapsed, setCollapsed] = useState<boolean>(initial.collapsed)

  const containerRef = useRef<HTMLDivElement>(null)
  const resizeStateRef = useRef<{
    startY: number
    startHeight: number
    maxHeight: number
  } | null>(null)

  const agentInputs = useAppStore(
    useShallow((s) => ({
      tabsByWorktree: s.tabsByWorktree,
      runtimePaneTitlesByTabId: s.runtimePaneTitlesByTabId,
      worktreesByRepo: s.worktreesByRepo
    }))
  )
  const activeAgentCount = useMemo(() => countWorkingAgents(agentInputs), [agentInputs])

  // Why: persist height + collapsed via localStorage (renderer-only) so the
  // layout survives reloads without threading through the main-process UI
  // store. Debounce writes so continuous drag doesn't spam localStorage.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed }))
      } catch {
        // ignore quota / privacy-mode errors
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [height, collapsed])

  const onResizeMove = useCallback((event: MouseEvent) => {
    const state = resizeStateRef.current
    if (!state) {
      return
    }
    const deltaY = state.startY - event.clientY
    const next = Math.max(MIN_HEIGHT, Math.min(state.maxHeight, state.startHeight + deltaY))
    setHeight(next)
  }, [])

  const onResizeEnd = useCallback(() => {
    resizeStateRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeEnd)
  }, [onResizeMove])

  const onResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (collapsed) {
        setCollapsed(false)
      }
      // Why: the panel's parent sidebar column is the constraint. Cap
      // expansion so the dashboard can't push the activity bar or panel
      // content to a zero-height strip. Leave 120px for the active panel.
      const sidebarEl = containerRef.current?.parentElement
      const sidebarHeight = sidebarEl?.getBoundingClientRect().height ?? 800
      const maxHeight = Math.max(MIN_HEIGHT, sidebarHeight - 160)
      resizeStateRef.current = {
        startY: event.clientY,
        startHeight: height,
        maxHeight
      }
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onResizeMove)
      window.addEventListener('mouseup', onResizeEnd)
    },
    [collapsed, height, onResizeMove, onResizeEnd]
  )

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)
    }
  }, [onResizeMove, onResizeEnd])

  const effectiveHeight = collapsed ? HEADER_HEIGHT : height

  return (
    <div
      ref={containerRef}
      className="relative flex shrink-0 flex-col border-t border-border bg-sidebar"
      style={{ height: effectiveHeight }}
    >
      {/* Resize handle. Hidden while collapsed — user must expand first. */}
      {!collapsed ? (
        <div
          className="absolute left-0 right-0 h-[6px] -mt-[3px] cursor-row-resize z-10 hover:bg-ring/20 active:bg-ring/30 transition-colors"
          onMouseDown={onResizeStart}
          aria-label="Resize dashboard panel"
        />
      ) : null}

      {/* Header: title + controls */}
      <div
        className="flex shrink-0 items-center px-2 gap-1 cursor-pointer select-none"
        style={{ height: HEADER_HEIGHT }}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <button
          type="button"
          className="flex items-center justify-center w-5 h-5 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? 'Expand dashboard' : 'Collapse dashboard'}
        >
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
        </span>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums ml-1">
          {activeAgentCount}
        </span>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={(event) => {
                event.stopPropagation()
                void window.api.ui.openAgentDashboard()
              }}
              aria-label="Open dashboard in new window"
            >
              <PanelTopOpen size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            Open in new window
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Body: full AgentDashboard */}
      {!collapsed ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <AgentDashboard />
        </div>
      ) : null}
    </div>
  )
}
