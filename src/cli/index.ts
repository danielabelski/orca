#!/usr/bin/env node
/* eslint-disable max-lines -- Why: the public CLI entrypoint keeps command dispatch in one place so the bundled shell command and development fallback stay behaviorally identical. */

import type {
  CliStatusResult,
  RuntimeRepoList,
  RuntimeRepoSearchRefs,
  RuntimeWorktreeRecord,
  RuntimeWorktreePsResult,
  RuntimeWorktreeListResult,
  RuntimeTerminalRead,
  RuntimeTerminalListResult,
  RuntimeTerminalShow,
  RuntimeTerminalSend,
  RuntimeTerminalWait
} from '../shared/runtime-types'
import {
  RuntimeClient,
  RuntimeClientError,
  RuntimeRpcFailureError,
  type RuntimeRpcSuccess
} from './runtime-client'
import type { RuntimeRpcFailure } from './runtime-client'

type ParsedArgs = {
  commandPath: string[]
  flags: Map<string, string | boolean>
}

const DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS = 5 * 60 * 1000

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.flags.has('help') || parsed.commandPath.length === 0) {
    printHelp()
    return
  }

  const client = new RuntimeClient()
  const json = parsed.flags.has('json')

  try {
    const { commandPath } = parsed

    if (matches(commandPath, ['open'])) {
      const result = await client.openOrca()
      return printResult(result, json, formatCliStatus)
    }

    if (matches(commandPath, ['status'])) {
      const result = await client.getCliStatus()
      if (!json && !result.result.runtime.reachable) {
        process.exitCode = 1
      }
      return printResult(result, json, formatStatus)
    }

    if (matches(commandPath, ['repo', 'list'])) {
      const result = await client.call<RuntimeRepoList>('repo.list')
      return printResult(result, json, formatRepoList)
    }

    if (matches(commandPath, ['repo', 'add'])) {
      const result = await client.call<{ repo: Record<string, unknown> }>('repo.add', {
        path: getRequiredStringFlag(parsed.flags, 'path')
      })
      return printResult(result, json, formatRepoShow)
    }

    if (matches(commandPath, ['repo', 'show'])) {
      const result = await client.call<{ repo: Record<string, unknown> }>('repo.show', {
        repo: getRequiredStringFlag(parsed.flags, 'repo')
      })
      return printResult(result, json, formatRepoShow)
    }

    if (matches(commandPath, ['repo', 'set-base-ref'])) {
      const result = await client.call<{ repo: Record<string, unknown> }>('repo.setBaseRef', {
        repo: getRequiredStringFlag(parsed.flags, 'repo'),
        ref: getRequiredStringFlag(parsed.flags, 'ref')
      })
      return printResult(result, json, formatRepoShow)
    }

    if (matches(commandPath, ['repo', 'search-refs'])) {
      const result = await client.call<RuntimeRepoSearchRefs>('repo.searchRefs', {
        repo: getRequiredStringFlag(parsed.flags, 'repo'),
        query: getRequiredStringFlag(parsed.flags, 'query'),
        limit: getOptionalPositiveIntegerFlag(parsed.flags, 'limit')
      })
      return printResult(result, json, formatRepoRefs)
    }

    if (matches(commandPath, ['terminal', 'list'])) {
      const result = await client.call<RuntimeTerminalListResult>('terminal.list', {
        worktree: getOptionalStringFlag(parsed.flags, 'worktree'),
        limit: getOptionalPositiveIntegerFlag(parsed.flags, 'limit')
      })
      return printResult(result, json, formatTerminalList)
    }

    if (matches(commandPath, ['terminal', 'show'])) {
      const result = await client.call<{ terminal: RuntimeTerminalShow }>('terminal.show', {
        terminal: getRequiredStringFlag(parsed.flags, 'terminal')
      })
      return printResult(result, json, formatTerminalShow)
    }

    if (matches(commandPath, ['terminal', 'read'])) {
      const result = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
        terminal: getRequiredStringFlag(parsed.flags, 'terminal')
      })
      return printResult(result, json, formatTerminalRead)
    }

    if (matches(commandPath, ['terminal', 'send'])) {
      const result = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
        terminal: getRequiredStringFlag(parsed.flags, 'terminal'),
        text: getOptionalStringFlag(parsed.flags, 'text'),
        enter: parsed.flags.get('enter') === true,
        interrupt: parsed.flags.get('interrupt') === true
      })
      return printResult(result, json, formatTerminalSend)
    }

    if (matches(commandPath, ['terminal', 'wait'])) {
      const timeoutMs = getOptionalPositiveIntegerFlag(parsed.flags, 'timeout-ms')
      const result = await client.call<{ wait: RuntimeTerminalWait }>(
        'terminal.wait',
        {
          terminal: getRequiredStringFlag(parsed.flags, 'terminal'),
          for: getRequiredStringFlag(parsed.flags, 'for'),
          timeoutMs
        },
        {
          // Why: terminal wait legitimately needs to outlive the CLI's default
          // RPC timeout. Even without an explicit server timeout, the client must
          // allow long waits instead of failing at the generic 15s transport cap.
          timeoutMs: timeoutMs ? timeoutMs + 5000 : DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS
        }
      )
      return printResult(result, json, formatTerminalWait)
    }

    if (matches(commandPath, ['terminal', 'stop'])) {
      const result = await client.call<{ stopped: number }>('terminal.stop', {
        worktree: getRequiredStringFlag(parsed.flags, 'worktree')
      })
      return printResult(result, json, (value) => `Stopped ${value.stopped} terminals.`)
    }

    if (matches(commandPath, ['worktree', 'ps'])) {
      const result = await client.call<RuntimeWorktreePsResult>('worktree.ps', {
        limit: getOptionalPositiveIntegerFlag(parsed.flags, 'limit')
      })
      return printResult(result, json, formatWorktreePs)
    }

    if (matches(commandPath, ['worktree', 'list'])) {
      const result = await client.call<RuntimeWorktreeListResult>('worktree.list', {
        repo: getOptionalStringFlag(parsed.flags, 'repo'),
        limit: getOptionalPositiveIntegerFlag(parsed.flags, 'limit')
      })
      return printResult(result, json, formatWorktreeList)
    }

    if (matches(commandPath, ['worktree', 'show'])) {
      const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
        worktree: getRequiredStringFlag(parsed.flags, 'worktree')
      })
      return printResult(result, json, formatWorktreeShow)
    }

    if (matches(commandPath, ['worktree', 'create'])) {
      const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.create', {
        repo: getRequiredStringFlag(parsed.flags, 'repo'),
        name: getRequiredStringFlag(parsed.flags, 'name'),
        baseBranch: getOptionalStringFlag(parsed.flags, 'base-branch'),
        linkedIssue: getOptionalNumberFlag(parsed.flags, 'issue'),
        comment: getOptionalStringFlag(parsed.flags, 'comment')
      })
      return printResult(result, json, formatWorktreeShow)
    }

    if (matches(commandPath, ['worktree', 'set'])) {
      const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.set', {
        worktree: getRequiredStringFlag(parsed.flags, 'worktree'),
        displayName: getOptionalStringFlag(parsed.flags, 'display-name'),
        linkedIssue: getOptionalNullableNumberFlag(parsed.flags, 'issue'),
        comment: getOptionalStringFlag(parsed.flags, 'comment')
      })
      return printResult(result, json, formatWorktreeShow)
    }

    if (matches(commandPath, ['worktree', 'rm'])) {
      const result = await client.call<{ removed: boolean }>('worktree.rm', {
        worktree: getRequiredStringFlag(parsed.flags, 'worktree'),
        force: parsed.flags.get('force') === true
      })
      return printResult(result, json, (value) => `removed: ${value.removed}`)
    }

    throw new RuntimeClientError('invalid_argument', `Unknown command: ${commandPath.join(' ')}`)
  } catch (error) {
    if (json) {
      if (error instanceof RuntimeRpcFailureError) {
        console.log(JSON.stringify(error.response, null, 2))
      } else {
        const response: RuntimeRpcFailure = {
          id: 'local',
          ok: false,
          error: {
            code: error instanceof RuntimeClientError ? error.code : 'runtime_error',
            message: formatCliError(error)
          },
          _meta: {
            runtimeId: null
          }
        }
        console.log(JSON.stringify(response, null, 2))
      }
    } else {
      console.error(formatCliError(error))
    }
    process.exitCode = 1
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const commandPath: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      commandPath.push(token)
      continue
    }

    const flag = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      flags.set(flag, true)
      continue
    }
    flags.set(flag, next)
    i += 1
  }

  return { commandPath, flags }
}

function getRequiredStringFlag(flags: Map<string, string | boolean>, name: string): string {
  const value = flags.get(name)
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  throw new RuntimeClientError('invalid_argument', `Missing required --${name}`)
}

function getOptionalStringFlag(
  flags: Map<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getOptionalNumberFlag(
  flags: Map<string, string | boolean>,
  name: string
): number | undefined {
  const value = flags.get(name)
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new RuntimeClientError('invalid_argument', `Invalid numeric value for --${name}`)
  }
  return parsed
}

function getOptionalPositiveIntegerFlag(
  flags: Map<string, string | boolean>,
  name: string
): number | undefined {
  const value = getOptionalNumberFlag(flags, name)
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RuntimeClientError('invalid_argument', `Invalid positive integer for --${name}`)
  }
  return value
}

function getOptionalNullableNumberFlag(
  flags: Map<string, string | boolean>,
  name: string
): number | null | undefined {
  const value = flags.get(name)
  if (value === 'null') {
    return null
  }
  return getOptionalNumberFlag(flags, name)
}

function matches(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  )
}

function printResult<TResult>(
  response: RuntimeRpcSuccess<TResult>,
  json: boolean,
  formatter: (value: TResult) => string
): void {
  if (json) {
    console.log(JSON.stringify(response, null, 2))
    return
  }
  console.log(formatter(response.result))
}

function formatStatus(status: CliStatusResult): string {
  return formatCliStatus(status)
}

function formatCliStatus(status: CliStatusResult): string {
  return [
    `appRunning: ${status.app.running}`,
    `pid: ${status.app.pid ?? 'none'}`,
    `runtimeState: ${status.runtime.state}`,
    `runtimeReachable: ${status.runtime.reachable}`,
    `runtimeId: ${status.runtime.runtimeId ?? 'none'}`,
    `graphState: ${status.graph.state}`
  ].join('\n')
}

function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (
    error instanceof RuntimeClientError &&
    (error.code === 'runtime_unavailable' || error.code === 'runtime_timeout')
  ) {
    return `${message}\nOrca is not running. Run 'orca open' first.`
  }
  if (
    error instanceof RuntimeRpcFailureError &&
    error.response.error.code === 'runtime_unavailable'
  ) {
    return `${message}\nOrca is not running. Run 'orca open' first.`
  }
  return message
}

function formatTerminalList(result: RuntimeTerminalListResult): string {
  if (result.terminals.length === 0) {
    return 'No live terminals.'
  }
  const body = result.terminals
    .map(
      (terminal) =>
        `${terminal.handle}  ${terminal.title ?? '(untitled)'}  ${terminal.connected ? 'connected' : 'disconnected'}  ${terminal.worktreePath}\n${terminal.preview ? `preview: ${terminal.preview}` : 'preview: <empty>'}`
    )
    .join('\n\n')
  return result.truncated
    ? `${body}\n\ntruncated: showing ${result.terminals.length} of ${result.totalCount}`
    : body
}

function formatTerminalShow(result: { terminal: RuntimeTerminalShow }): string {
  const terminal = result.terminal
  return [
    `handle: ${terminal.handle}`,
    `title: ${terminal.title ?? '(untitled)'}`,
    `worktree: ${terminal.worktreePath}`,
    `branch: ${terminal.branch}`,
    `leaf: ${terminal.leafId}`,
    `ptyId: ${terminal.ptyId ?? 'none'}`,
    `connected: ${terminal.connected}`,
    `writable: ${terminal.writable}`,
    `preview: ${terminal.preview || '<empty>'}`
  ].join('\n')
}

function formatTerminalRead(result: { terminal: RuntimeTerminalRead }): string {
  const terminal = result.terminal
  return [`handle: ${terminal.handle}`, `status: ${terminal.status}`, '', ...terminal.tail].join(
    '\n'
  )
}

function formatTerminalSend(result: { send: RuntimeTerminalSend }): string {
  return `Sent ${result.send.bytesWritten} bytes to ${result.send.handle}.`
}

function formatTerminalWait(result: { wait: RuntimeTerminalWait }): string {
  return [
    `handle: ${result.wait.handle}`,
    `condition: ${result.wait.condition}`,
    `satisfied: ${result.wait.satisfied}`,
    `status: ${result.wait.status}`,
    `exitCode: ${result.wait.exitCode ?? 'null'}`
  ].join('\n')
}

function formatWorktreePs(result: RuntimeWorktreePsResult): string {
  if (result.worktrees.length === 0) {
    return 'No worktrees found.'
  }
  const body = result.worktrees
    .map(
      (worktree) =>
        `${worktree.repo} ${worktree.branch}  live:${worktree.liveTerminalCount}  pty:${worktree.hasAttachedPty ? 'yes' : 'no'}  unread:${worktree.unread ? 'yes' : 'no'}\n${worktree.path}${worktree.preview ? `\npreview: ${worktree.preview}` : ''}`
    )
    .join('\n\n')
  return result.truncated
    ? `${body}\n\ntruncated: showing ${result.worktrees.length} of ${result.totalCount}`
    : body
}

function formatRepoList(result: RuntimeRepoList): string {
  if (result.repos.length === 0) {
    return 'No repos found.'
  }
  return result.repos.map((repo) => `${repo.id}  ${repo.displayName}  ${repo.path}`).join('\n')
}

function formatRepoShow(result: { repo: Record<string, unknown> }): string {
  return Object.entries(result.repo)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    )
    .join('\n')
}

function formatRepoRefs(result: RuntimeRepoSearchRefs): string {
  if (result.refs.length === 0) {
    return 'No refs found.'
  }
  return result.truncated ? `${result.refs.join('\n')}\n\ntruncated: yes` : result.refs.join('\n')
}

function formatWorktreeList(result: RuntimeWorktreeListResult): string {
  if (result.worktrees.length === 0) {
    return 'No worktrees found.'
  }
  const body = result.worktrees
    .map(
      (worktree) =>
        `${String(worktree.id)}  ${String(worktree.branch)}  ${String(worktree.path)}\ndisplayName: ${String(worktree.displayName ?? '')}\nlinkedIssue: ${String(worktree.linkedIssue ?? 'null')}\ncomment: ${String(worktree.comment ?? '')}`
    )
    .join('\n\n')
  return result.truncated
    ? `${body}\n\ntruncated: showing ${result.worktrees.length} of ${result.totalCount}`
    : body
}

function formatWorktreeShow(result: { worktree: RuntimeWorktreeRecord }): string {
  const worktree = result.worktree
  return Object.entries(worktree)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    )
    .join('\n')
}

function printHelp(): void {
  console.log(`orca

Usage:
  orca open [--json]
  orca status [--json]
  orca repo list [--json]
  orca repo add --path <path> [--json]
  orca repo show --repo <selector> [--json]
  orca repo set-base-ref --repo <selector> --ref <ref> [--json]
  orca repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]
  orca worktree list [--repo <selector>] [--limit <n>] [--json]
  orca worktree show --worktree <selector> [--json]
  orca worktree create --repo <selector> --name <name> [--base-branch <ref>] [--issue <number>] [--comment <text>] [--json]
  orca worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--comment <text>] [--json]
  orca worktree rm --worktree <selector> [--force] [--json]
  orca worktree ps [--limit <n>] [--json]
  orca terminal list [--worktree <selector>] [--limit <n>] [--json]
  orca terminal show --terminal <handle> [--json]
  orca terminal read --terminal <handle> [--json]
  orca terminal send --terminal <handle> [--text <text>] [--enter] [--interrupt] [--json]
  orca terminal wait --terminal <handle> --for exit [--timeout-ms <ms>] [--json]
  orca terminal stop --worktree <selector> [--json]`)
}

void main()
