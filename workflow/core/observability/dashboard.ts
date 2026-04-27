/**
 * @fileoverview Lightweight TUI dashboard for pipeline observability.
 *
 * Renders a live-updating terminal view of pipeline execution:
 * - Pipeline header (runId, name, status, elapsed)
 * - Per-agent cards (status, model, tools, cost, tokens, duration)
 * - Step progression timeline
 *
 * Zero external dependencies — uses ANSI escape codes directly.
 *
 * @example
 * ```ts
 * import { Pipeline } from './pipeline.js'
 * import { Dashboard } from './dashboard.js'
 *
 * const pipeline = new Pipeline('my-pipeline')
 *   .step('researcher', { systemPrompt: '...' })
 *   .step('writer', { systemPrompt: '...' })
 *
 * const result = await pipeline
 *   .options({ onEvent: Dashboard.liveLogger() })
 *   .run('Write an article')
 *
 * // Or print a static summary after execution:
 * Dashboard.printSummary(result.summary)
 * ```
 */

import type { PipelineRunSummary, AgentTraceSummary, TraceEvent } from './tracer.js'
import type { AgentLogEvent } from '../agent/claude-agent.js'

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ESC = '\x1b['
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const GREEN = `${ESC}32m`
const RED = `${ESC}31m`
const YELLOW = `${ESC}33m`
const CYAN = `${ESC}36m`
const MAGENTA = `${ESC}35m`
const BLUE = `${ESC}34m`
const WHITE = `${ESC}37m`

function colorize(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${RESET}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': case 'in-progress': return YELLOW
    case 'completed': return GREEN
    case 'error': return RED
    default: return DIM
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '⏳'
    case 'completed': return '✅'
    case 'error': return '❌'
    case 'idle': return '⬜'
    default: return '❔'
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m${secs}s`
}

function formatCost(usd: number | undefined): string {
  if (usd == null || usd === 0) return '-'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Static utility class for pipeline observability output.
 */
export class Dashboard {
  /**
   * Print a formatted pipeline summary to stdout.
   */
  static printSummary(summary: PipelineRunSummary): void {
    const lines: string[] = []

    // ── Header ──
    lines.push('')
    lines.push(colorize('═══════════════════════════════════════════════════════════', BOLD, CYAN))
    lines.push(colorize(`  Pipeline: ${summary.pipelineName}`, BOLD, WHITE))
    lines.push(`  ${colorize('Run ID:', DIM)} ${summary.runId}`)
    lines.push(`  ${colorize('Status:', DIM)} ${statusIcon(summary.status)} ${colorize(summary.status, BOLD, statusColor(summary.status))}`)
    lines.push(`  ${colorize('Duration:', DIM)} ${formatDuration(summary.durationMs)}`)
    lines.push(`  ${colorize('Cost:', DIM)} ${formatCost(summary.totalCostUsd)}`)
    lines.push(`  ${colorize('Tokens:', DIM)} ${formatTokens(summary.totalTokens.input)} in / ${formatTokens(summary.totalTokens.output)} out`)
    lines.push(colorize('═══════════════════════════════════════════════════════════', BOLD, CYAN))

    // ── Steps timeline ──
    if (summary.steps.length > 0) {
      lines.push('')
      lines.push(colorize('  Steps:', BOLD))
      for (let i = 0; i < summary.steps.length; i++) {
        const step = summary.steps[i]!
        const connector = i < summary.steps.length - 1 ? '├─' : '└─'
        lines.push(`    ${colorize(connector, DIM)} ${step}`)
      }
    }

    // ── Agent cards ──
    lines.push('')
    lines.push(colorize('  Agents:', BOLD))
    lines.push('')

    for (const agent of summary.agents) {
      lines.push(Dashboard.formatAgentCard(agent))
    }

    lines.push(colorize('═══════════════════════════════════════════════════════════', BOLD, CYAN))
    lines.push('')

    process.stdout.write(lines.join('\n'))
  }

  /**
   * Format a single agent summary as a card.
   */
  static formatAgentCard(agent: AgentTraceSummary): string {
    const lines: string[] = []
    const icon = statusIcon(agent.status)
    const nameColor = agent.status === 'error' ? RED : agent.status === 'completed' ? GREEN : YELLOW

    lines.push(`    ${colorize('┌─', DIM)} ${icon} ${colorize(agent.agentName, BOLD, nameColor)}`)

    // Status + duration
    lines.push(`    ${colorize('│', DIM)}  ${colorize('Status:', DIM)}    ${colorize(agent.status, statusColor(agent.status))}  ${formatDuration(agent.durationMs)}`)

    // Model
    if (agent.model) {
      lines.push(`    ${colorize('│', DIM)}  ${colorize('Model:', DIM)}     ${agent.model}`)
    }

    // Cost + tokens
    if (agent.costUsd || agent.tokenUsage) {
      const costStr = formatCost(agent.costUsd)
      const inTok = agent.tokenUsage ? formatTokens(agent.tokenUsage.input_tokens) : '-'
      const outTok = agent.tokenUsage ? formatTokens(agent.tokenUsage.output_tokens) : '-'
      lines.push(`    ${colorize('│', DIM)}  ${colorize('Cost:', DIM)}      ${costStr}  (${inTok} in / ${outTok} out)`)
    }

    // Tool calls
    if (agent.toolCalls.length > 0) {
      const toolNames = [...new Set(agent.toolCalls.map(t => t.tool))]
      const summary = toolNames.length <= 5
        ? toolNames.join(', ')
        : `${toolNames.slice(0, 5).join(', ')} +${toolNames.length - 5}`
      lines.push(`    ${colorize('│', DIM)}  ${colorize('Tools:', DIM)}     ${agent.toolCalls.length} calls (${summary})`)
    }

    // Config snapshot
    if (agent.config) {
      const configParts: string[] = []
      if (agent.config.tools) configParts.push(`tools: ${(agent.config.tools as string[]).length}`)
      if (agent.config.skills) configParts.push(`skills: ${(agent.config.skills as string[]).length}`)
      if (agent.config.permissionMode) configParts.push(`perm: ${agent.config.permissionMode}`)
      if (agent.config.cwd) configParts.push(`cwd: ${agent.config.cwd}`)
      if (configParts.length > 0) {
        lines.push(`    ${colorize('│', DIM)}  ${colorize('Config:', DIM)}    ${configParts.join(' | ')}`)
      }
    }

    // Output preview
    if (agent.outputText) {
      const preview = agent.outputText.replace(/\n/g, ' ').slice(0, 80)
      lines.push(`    ${colorize('│', DIM)}  ${colorize('Output:', DIM)}    ${preview}${agent.outputText.length > 80 ? '...' : ''}`)
    }

    lines.push(`    ${colorize('└─', DIM)}`)
    return lines.join('\n')
  }

  /**
   * Create a live logger callback for use with `Pipeline.options({ onEvent })`.
   *
   * Prints each event as a compact one-line log, useful for real-time monitoring.
   */
  static liveLogger(): (event: AgentLogEvent) => void {
    const startMs = Date.now()

    return (event: AgentLogEvent) => {
      const elapsed = formatDuration(Date.now() - startMs)
      const prefix = colorize(`[${elapsed}]`, DIM)
      const agent = colorize(pad(event.agentName, 16), BOLD, CYAN)

      switch (event.type) {
        case 'system_init': {
          const model = event.data.model ?? 'default'
          const tools = (event.data.tools as string[] | undefined)?.length ?? 0
          process.stdout.write(`${prefix} ${agent} ${colorize('INIT', GREEN)} model=${model} tools=${tools}\n`)
          break
        }
        case 'assistant_text': {
          const text = (event.data.text as string ?? '').replace(/\n/g, ' ').slice(0, 60)
          process.stdout.write(`${prefix} ${agent} ${colorize('TEXT', BLUE)} ${text}${(event.data.text as string ?? '').length > 60 ? '...' : ''}\n`)
          break
        }
        case 'tool_call': {
          const tool = event.data.tool_name as string ?? 'unknown'
          process.stdout.write(`${prefix} ${agent} ${colorize('TOOL', MAGENTA)} ${tool}\n`)
          break
        }
        case 'tool_result': {
          process.stdout.write(`${prefix} ${agent} ${colorize('TRES', DIM)} done\n`)
          break
        }
        case 'result': {
          const cost = formatCost(event.data.cost_usd as number | undefined)
          const turns = event.data.num_turns ?? '?'
          const isErr = event.data.is_error as boolean
          const tag = isErr ? colorize('FAIL', RED) : colorize('DONE', GREEN)
          process.stdout.write(`${prefix} ${agent} ${tag} cost=${cost} turns=${turns}\n`)
          break
        }
        case 'tool_progress': {
          // Skip noisy progress events
          break
        }
        default: {
          process.stdout.write(`${prefix} ${agent} ${colorize(event.type, DIM)}\n`)
        }
      }
    }
  }

  /**
   * Create a compact JSON-lines logger for file output or structured logging.
   */
  static jsonLogger(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): (event: AgentLogEvent) => void {
    return (event: AgentLogEvent) => {
      write(JSON.stringify({
        ts: new Date().toISOString(),
        agent: event.agentName,
        type: event.type,
        ...event.data,
      }))
    }
  }

  /**
   * Print a minimal one-line summary (useful for CI/batch runs).
   */
  static printOneLine(summary: PipelineRunSummary): void {
    const s = summary.status === 'completed' ? colorize('OK', GREEN) : colorize('FAIL', RED)
    const agents = summary.agents.map(a => `${a.agentName}:${a.status}`).join(' ')
    process.stdout.write(
      `${s} ${summary.pipelineName} [${summary.runId.slice(0, 8)}] ${formatDuration(summary.durationMs)} ${formatCost(summary.totalCostUsd)} | ${agents}\n`,
    )
  }
}
