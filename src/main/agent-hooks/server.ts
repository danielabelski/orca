import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import {
  parseAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../shared/agent-status-types'

type AgentHookSource = 'claude' | 'codex'

type AgentHookEventPayload = {
  paneKey: string
  payload: ParsedAgentStatusPayload
}

function extractPromptText(hookPayload: Record<string, unknown>): string {
  // Why: Claude documents `prompt` on UserPromptSubmit, but different agents
  // may use slightly different field names. Check a small allowlist so we can
  // capture the user prompt when it is present without depending on one exact
  // provider-specific key everywhere in the renderer.
  const candidateKeys = ['prompt', 'user_prompt', 'userPrompt', 'message']
  for (const key of candidateKeys) {
    const value = hookPayload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return ''
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 1_000_000) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function normalizeClaudeEvent(
  eventName: unknown,
  promptText: string
): ParsedAgentStatusPayload | null {
  // Why: Claude's Stop event is the primary "turn complete" signal, but the
  // SubagentStop and SessionEnd events also mark turn/session completion. If
  // only Stop is treated as "done", a session whose last event is one of the
  // other stop events lingers in whatever the previous state was — most often
  // "working" from a trailing PostToolUse, which then decays to heuristic
  // "idle" when the entry goes stale. Treating all terminal events as "done"
  // matches the user's mental model: Claude is no longer actively working.
  const state =
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure'
      ? 'working'
      : eventName === 'PermissionRequest'
        ? 'waiting'
        : eventName === 'Stop' || eventName === 'SubagentStop' || eventName === 'SessionEnd'
          ? 'done'
          : null

  if (!state) {
    return null
  }

  return parseAgentStatusPayload(
    JSON.stringify({
      state,
      statusText:
        state === 'waiting'
          ? 'Waiting for permission'
          : state === 'done'
            ? 'Turn complete'
            : 'Responding to prompt',
      promptText,
      agentType: 'claude'
    })
  )
}

function normalizeCodexEvent(
  eventName: unknown,
  promptText: string
): ParsedAgentStatusPayload | null {
  // Why: Codex's PreToolUse fires on every tool invocation, not only on user
  // approval prompts, so mapping it to "waiting" turned every running Codex
  // agent into "Waiting for permission". Only map events that unambiguously
  // indicate lifecycle transitions.
  const state =
    eventName === 'SessionStart' || eventName === 'UserPromptSubmit'
      ? 'working'
      : eventName === 'Stop'
        ? 'done'
        : null

  if (!state) {
    return null
  }

  return parseAgentStatusPayload(
    JSON.stringify({
      state,
      statusText: state === 'done' ? 'Turn complete' : 'Responding to prompt',
      promptText,
      agentType: 'codex'
    })
  )
}

function normalizeHookPayload(
  source: AgentHookSource,
  body: unknown
): AgentHookEventPayload | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  const paneKey = typeof record.paneKey === 'string' ? record.paneKey.trim() : ''
  const hookPayload = record.payload
  if (!paneKey || typeof hookPayload !== 'object' || hookPayload === null) {
    return null
  }

  const eventName = (hookPayload as Record<string, unknown>).hook_event_name
  const promptText = extractPromptText(hookPayload as Record<string, unknown>)
  const payload =
    source === 'claude'
      ? normalizeClaudeEvent(eventName, promptText)
      : normalizeCodexEvent(eventName, promptText)

  return payload ? { paneKey, payload } : null
}

export class AgentHookServer {
  private server: ReturnType<typeof createServer> | null = null
  private port = 0
  private token = ''
  private onAgentStatus: ((payload: AgentHookEventPayload) => void) | null = null

  setListener(listener: ((payload: AgentHookEventPayload) => void) | null): void {
    this.onAgentStatus = listener
  }

  async start(): Promise<void> {
    if (this.server) {
      return
    }

    this.token = randomUUID()
    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        console.log('[agent-hooks] reject non-POST', req.method, req.url)
        res.writeHead(404)
        res.end()
        return
      }

      if (req.headers['x-orca-agent-hook-token'] !== this.token) {
        console.log('[agent-hooks] token mismatch on', req.url)
        res.writeHead(403)
        res.end()
        return
      }

      try {
        const body = await readJsonBody(req)
        const source =
          req.url === '/hook/claude' ? 'claude' : req.url === '/hook/codex' ? 'codex' : null
        if (!source) {
          console.log('[agent-hooks] unknown path', req.url)
          res.writeHead(404)
          res.end()
          return
        }

        const payload = normalizeHookPayload(source, body)
        console.log('[agent-hooks] received', {
          source,
          eventName: (body as { payload?: { hook_event_name?: unknown } })?.payload
            ?.hook_event_name,
          paneKey: (body as { paneKey?: unknown })?.paneKey,
          normalized: payload?.payload.state ?? null
        })
        if (payload) {
          this.onAgentStatus?.(payload)
        }

        res.writeHead(204)
        res.end()
      } catch (error) {
        console.log('[agent-hooks] error handling request', error)
        // Why: agent hooks must fail open. The receiver returns success for
        // malformed payloads so a newer or broken hook never blocks the agent.
        res.writeHead(204)
        res.end()
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address()
        if (address && typeof address === 'object') {
          this.port = address.port
        }
        console.log('[agent-hooks] receiver listening', { port: this.port })
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.port = 0
    this.token = ''
    this.onAgentStatus = null
  }

  buildPtyEnv(): Record<string, string> {
    if (this.port <= 0 || !this.token) {
      return {}
    }

    return {
      ORCA_AGENT_HOOK_PORT: String(this.port),
      ORCA_AGENT_HOOK_TOKEN: this.token
    }
  }
}

export const agentHookServer = new AgentHookServer()
