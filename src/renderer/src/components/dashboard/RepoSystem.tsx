import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentIcon } from '@/lib/agent-catalog'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'
import type { TuiAgent } from '../../../../shared/types'
import type {
  DashboardRepoGroup,
  DashboardAgentRow,
  DashboardWorktreeCard
} from './useDashboardData'
import type { TooltipData } from './ConcentricView'

// ─── State Colors ────────────────────────────────────────────────────────────
// Why: hardcoded hex values ensure consistent rendering regardless of CSS
// variable availability. These match the Tailwind color tokens used elsewhere
// (emerald-500, amber-500, sky-500, zinc-500).
const STATE_COLORS: Record<string, { fill: string; glow: string }> = {
  working: { fill: '#10b981', glow: '#34d399' },
  blocked: { fill: '#f59e0b', glow: '#fbbf24' },
  waiting: { fill: '#f59e0b', glow: '#fbbf24' },
  done: { fill: '#0ea5e9', glow: '#38bdf8' },
  idle: { fill: '#71717a', glow: '#a1a1aa' }
}

export function stateColor(state: string): { fill: string; glow: string } {
  return STATE_COLORS[state] ?? STATE_COLORS.idle
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s
}

// Why: state-to-badge mapping matches the dashboard mock — RUNNING, PAUSED,
// DONE, IDLE labels sit in the top-right of every agent tile. `waiting` is
// folded into PAUSED to match the blocked/paused bucket used elsewhere.
function agentStateBadge(state: string): string {
  switch (state) {
    case 'working':
      return 'RUNNING'
    case 'blocked':
    case 'waiting':
      return 'PAUSED'
    case 'done':
      return 'DONE'
    case 'idle':
      return 'IDLE'
    default:
      return state.toUpperCase()
  }
}

// ─── RepoSystem Component ────────────────────────────────────────────────────
// Why: renders each repo as a card containing a grid of rounded-square
// worktree tiles. Worktrees are sorted by `latestActivityAt` descending so the
// most recently active tile sits at the top-left. Each tile shows the dominant
// state via a left color bar + pill, the worktree name + branch, and a compact
// list of agent rows. "Done" worktrees get an explicit dismiss (X) button so
// clicking the tile itself navigates (like any other state) while dismissal is
// opt-in.
export type RepoSystemProps = {
  group: DashboardRepoGroup
  onClick: (worktreeId: string) => void
  onDismiss: (worktreeId: string) => void
  onShowTooltip: (e: React.MouseEvent, data: Omit<TooltipData, 'x' | 'y'>) => void
  onHideTooltip: () => void
}

const RepoSystem = React.memo(function RepoSystem({
  group,
  onClick,
  onDismiss,
  onShowTooltip,
  onHideTooltip
}: RepoSystemProps) {
  // Why: sort most-recent-first so the tile the user most likely cares about
  // sits at the top-left corner of the repo's grid. Worktrees with no activity
  // timestamp (latestActivityAt === 0) fall to the end in their natural order.
  const activeWorktrees = group.worktrees
    .filter((wt) => wt.agents.length > 0)
    .slice()
    .sort((a, b) => b.latestActivityAt - a.latestActivityAt)
  const totalAgents = activeWorktrees.reduce((s, w) => s + w.agents.length, 0)

  return (
    <div className="w-full max-w-[560px] rounded-lg border-2 border-border bg-accent/10 p-2.5">
      {/* Repo header */}
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.repo.badgeColor }}
        />
        <span className="truncate text-[12px] font-semibold text-foreground">
          {truncate(group.repo.displayName, 28)}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
          {activeWorktrees.length} wt · {totalAgents} agent{totalAgents !== 1 ? 's' : ''}
        </span>
        {group.attentionCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-500">
            {group.attentionCount}
          </span>
        )}
      </div>

      {activeWorktrees.length === 0 ? (
        <div className="px-1 py-4 text-center text-[10px] italic text-muted-foreground/40">
          No active agents
        </div>
      ) : (
        // Why: each worktree gets its own outlined group so the visual
        // hierarchy reads repo → worktree → agents. Agents inside a worktree
        // are still laid out as fixed-size square tiles.
        <div className="flex flex-col gap-2">
          {activeWorktrees.map((card) => (
            <WorktreeGroup
              key={card.worktree.id}
              card={card}
              onClick={onClick}
              onDismiss={onDismiss}
              onShowTooltip={onShowTooltip}
              onHideTooltip={onHideTooltip}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// ─── WorktreeGroup ───────────────────────────────────────────────────────────
// Why: outlines a single worktree's agents so the repo → worktree → agent
// hierarchy is visually clear. Shows the worktree name/branch in a small
// header above its agent tiles.
type WorktreeGroupProps = {
  card: DashboardWorktreeCard
  onClick: (worktreeId: string) => void
  onDismiss: (worktreeId: string) => void
  onShowTooltip: (e: React.MouseEvent, data: Omit<TooltipData, 'x' | 'y'>) => void
  onHideTooltip: () => void
}

const WorktreeGroup = React.memo(function WorktreeGroup({
  card,
  onClick,
  onDismiss,
  onShowTooltip,
  onHideTooltip
}: WorktreeGroupProps) {
  return (
    <div className="rounded-md border-2 border-border/80 bg-background/20 p-1.5">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          {truncate(card.worktree.displayName, 28)}
        </span>
        <span className="ml-auto shrink-0 text-[9.5px] text-muted-foreground/50">
          {card.agents.length} agent{card.agents.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div
        className="grid gap-1.5"
        // Why: fixed-width columns (not 1fr) so each agent tile renders at a
        // constant size regardless of container width or how many tiles are
        // in the row. aspect-square on the tile then gives a constant height.
        style={{ gridTemplateColumns: 'repeat(auto-fill, 120px)' }}
      >
        {card.agents.map((agent) => (
          <AgentSquareTile
            key={agent.paneKey}
            agent={agent}
            card={card}
            onClick={onClick}
            onDismiss={onDismiss}
            onShowTooltip={onShowTooltip}
            onHideTooltip={onHideTooltip}
          />
        ))}
      </div>
    </div>
  )
})

// ─── AgentSquareTile ─────────────────────────────────────────────────────────
// Why: a single agent's square card — matches the dashboard mock. The tile is
// aspect-square and shows a state badge top-right (RUNNING / PAUSED / DONE /
// IDLE), the agent name prominently, and the parent worktree's name/path
// underneath. Hover surfaces the full tooltip via the same mechanism the old
// row-based layout used.
type AgentSquareTileProps = {
  agent: DashboardAgentRow
  card: DashboardWorktreeCard
  onClick: (worktreeId: string) => void
  onDismiss: (worktreeId: string) => void
  onShowTooltip: (e: React.MouseEvent, data: Omit<TooltipData, 'x' | 'y'>) => void
  onHideTooltip: () => void
}

const AgentSquareTile = React.memo(function AgentSquareTile({
  agent,
  card,
  onClick,
  onDismiss
}: AgentSquareTileProps) {
  const sc = stateColor(agent.state)
  const isWorking = agent.state === 'working'
  const isBlocked = agent.state === 'blocked' || agent.state === 'waiting'
  const isDone = agent.state === 'done'
  const agentLabel = formatAgentTypeLabel(agent.agentType)
  // Why: show the submitted prompt — the user's question/task — inside the
  // tile. statusText (e.g. "Turn complete") is transient agent chatter and
  // not what the user wants to see at a glance; fall back to it only if no
  // prompt was captured.
  const promptText = (agent.promptText || agent.statusText || '').trim()

  const history = agent.entry?.stateHistory ?? []
  const blocks = [
    ...history.map((h) => ({
      state: h.state,
      title: `${h.state}${h.statusText ? ` — ${h.statusText}` : ''}`
    })),
    {
      state: agent.state,
      title: `${agent.state}${agent.statusText ? ` — ${agent.statusText}` : ''}`
    }
  ]

  // Why: fixed-width blocks (matching the old hover popover) so each turn is
  // legibly sized and doesn't stretch with the tile. Cap count to fit within
  // the tile width without wrapping.
  const MAX_BLOCKS = 8
  const visibleBlocks = blocks.slice(-MAX_BLOCKS)

  return (
    <div
      className={cn(
        'group relative flex aspect-square cursor-pointer flex-col overflow-hidden rounded-lg border-2 bg-background/40 p-1.5',
        'transition-colors hover:bg-background/70'
      )}
      style={{ borderColor: `${sc.fill}88` }}
      onClick={() => onClick(card.worktree.id)}
    >
      {/* Working/blocked glow overlay — same breathing treatment the
          worktree-level tile had, now applied per-agent. */}
      {(isWorking || isBlocked) && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse rounded-lg"
          style={{
            boxShadow: `inset 0 0 14px ${sc.glow}40`,
            animationDuration: isBlocked ? '1.5s' : '3s'
          }}
        />
      )}

      {/* Top row: yellow bell (done) on the left, state badge + dismiss on the right. */}
      <div className="relative flex items-start gap-1">
        {isDone && <FilledBellIcon className="size-3.5 shrink-0 text-amber-500 drop-shadow-sm" />}
        <span
          className="ml-auto rounded px-1 py-[1px] text-[8px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: `${sc.fill}22`, color: sc.fill }}
        >
          {agentStateBadge(agent.state)}
        </span>
        {isDone && (
          <button
            type="button"
            className="flex size-3.5 items-center justify-center rounded text-muted-foreground/70 opacity-60 hover:bg-background/70 hover:text-foreground hover:opacity-100 group-hover:opacity-100"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              // Why: stopPropagation so the tile's own onClick (which
              // navigates to the terminal) doesn't fire.
              e.stopPropagation()
              onDismiss(card.worktree.id)
            }}
            aria-label="Dismiss completed agent"
            title="Remove from view"
          >
            <X size={9} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Body: agent icon then prompt stacked vertically at the top of the
          tile. The icon replaces the textual agent name (claude/codex/…)
          with the same SVG/favicon we render in the workspace selector. */}
      <div className="relative mt-1 min-w-0">
        <span
          className="flex size-4 shrink-0 items-center justify-center text-foreground"
          title={agentLabel}
          aria-label={agentLabel}
        >
          <AgentIcon agent={agent.agentType as TuiAgent} size={14} />
        </span>
        {/* Current prompt/status — the action in this turn. Line-clamped to
            2 rows so it never pushes the tile larger than aspect-square. */}
        {promptText && (
          <div
            className="mt-1 overflow-hidden text-[11px] font-medium leading-snug text-foreground/90"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2
            }}
            title={promptText}
          >
            {promptText}
          </div>
        )}
      </div>

      {/* Past-turn blocks — pinned to the bottom of the tile so they form a
          consistent baseline across agents regardless of prompt length. */}
      {visibleBlocks.length > 0 && (
        <div className="relative mt-auto flex flex-wrap items-center gap-[2px] pt-1">
          {visibleBlocks.map((block, i) => {
            const bc = stateColor(block.state)
            return (
              <span
                key={`${i}-${block.state}`}
                title={block.title}
                className="h-1.5 w-3 rounded-sm"
                style={{ backgroundColor: bc.fill, opacity: 0.8 }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

export default RepoSystem
