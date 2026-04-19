import React from 'react'
import { cn } from '@/lib/utils'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import type { DashboardAgentRow as DashboardAgentRowData } from './useDashboardData'

function currentDotClasses(state: string): string {
  switch (state) {
    case 'working':
      return 'bg-emerald-500'
    case 'blocked':
    case 'waiting':
      return 'bg-amber-500 animate-pulse'
    case 'done':
      return 'bg-sky-500/70'
    case 'idle':
    default:
      return 'bg-zinc-400/40'
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'working':
      return 'Working'
    case 'blocked':
      return 'Blocked'
    case 'waiting':
      return 'Waiting'
    case 'done':
      return 'Done'
    case 'idle':
      return 'Idle'
    default:
      return state
  }
}

function stateLabelColor(state: string): string {
  switch (state) {
    case 'working':
      return 'text-emerald-500'
    case 'blocked':
    case 'waiting':
      return 'text-amber-500'
    case 'done':
      return 'text-sky-500/80'
    default:
      return 'text-zinc-500'
  }
}

// Why: the tooltip preserves the fuller prompt/status text so no information
// is permanently hidden behind the compact row layout.
function rowTooltip(agent: DashboardAgentRowData): string {
  const parts: string[] = []
  const prompt = agent.promptText.trim()
  const status = agent.statusText.trim()
  if (prompt) {
    parts.push(`Prompt: ${prompt}`)
  }
  if (status) {
    parts.push(status)
  }
  return parts.join('\n')
}

type Props = {
  agent: DashboardAgentRowData
}

const DashboardAgentRow = React.memo(function DashboardAgentRow({ agent }: Props) {
  const agentLabel = formatAgentTypeLabel(agent.agentType)
  const tooltip = rowTooltip(agent)

  return (
    <div title={tooltip || undefined} className={cn('rounded px-1.5 py-1 bg-background/30')}>
      <div className="flex items-center gap-1.5">
        <span className={cn('size-[6px] shrink-0 rounded-full', currentDotClasses(agent.state))} />
        <span className="text-[10px] font-medium text-foreground/80 truncate">{agentLabel}</span>
        <span className={cn('ml-auto text-[10px] font-medium', stateLabelColor(agent.state))}>
          {stateLabel(agent.state)}
        </span>
      </div>
    </div>
  )
})

export default DashboardAgentRow
