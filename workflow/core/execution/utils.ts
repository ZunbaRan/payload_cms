/**
 * @fileoverview Utility functions shared across the Claude SDK orchestration layer.
 */

import type { Task } from '../shared-types.js'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Task helpers (re-exported from original framework for convenience)
// ---------------------------------------------------------------------------

export {
  isTaskReady,
  getTaskDependencyOrder,
  validateTaskDependencies,
} from './task-util.js'

export { createTask } from './task-util.js'

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
}

export const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

// ---------------------------------------------------------------------------
// SDK executable path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the Claude Agent SDK CLI executable.
 * Priority: explicit arg > CLAUDE_AGENT_EXECUTABLE_PATH env > local node_modules
 */
export function resolveClaudeCodeExecutablePath(explicitPath?: string): string {
  if (explicitPath) return explicitPath
  if (process.env.CLAUDE_AGENT_EXECUTABLE_PATH) return process.env.CLAUDE_AGENT_EXECUTABLE_PATH
  return path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRY_DELAY_MS = 30_000

export function computeRetryDelay(
  baseDelay: number,
  backoff: number,
  attempt: number,
): number {
  return Math.min(baseDelay * backoff ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function executeWithRetry<T>(
  run: () => Promise<T>,
  task: Task,
  onRetry?: (data: { attempt: number; maxAttempts: number; error: string; nextDelayMs: number }) => void,
  delayFn: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  const rawRetries = Number.isFinite(task.maxRetries) ? task.maxRetries! : 0
  const maxAttempts = Math.max(0, rawRetries) + 1
  const baseDelay = Math.max(0, Number.isFinite(task.retryDelayMs) ? task.retryDelayMs! : 1000)
  const backoff = Math.max(1, Number.isFinite(task.retryBackoff) ? task.retryBackoff! : 2)

  let lastError: string = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run()
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)

      if (attempt < maxAttempts) {
        const delay = computeRetryDelay(baseDelay, backoff, attempt)
        onRetry?.({ attempt, maxAttempts, error: lastError, nextDelayMs: delay })
        await delayFn(delay)
        continue
      }

      throw err
    }
  }

  throw new Error(lastError)
}

// ---------------------------------------------------------------------------
// Parsed task spec (result of coordinator decomposition)
// ---------------------------------------------------------------------------

export interface ParsedTaskSpec {
  title: string
  description: string
  assignee?: string
  dependsOn?: string[]
}

/**
 * Extract a JSON array of task specs from coordinator output.
 * Handles ```json fences and bare arrays.
 */
export function parseTaskSpecs(raw: string): ParsedTaskSpec[] | null {
  // Strategy 1: look for fenced JSON block
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/)
  const candidate = fenceMatch ? fenceMatch[1]! : raw

  // Strategy 2: find the first '[' and the FIRST matching ']'
  // (use first ']' after first '[' to handle duplicate outputs)
  const arrayStart = candidate.indexOf('[')
  if (arrayStart === -1) return null
  
  // Find the matching closing bracket by counting brackets, skipping string contents
  let depth = 0
  let arrayEnd = -1
  let inString = false
  let escape = false
  for (let i = arrayStart; i < candidate.length; i++) {
    const ch = candidate[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        arrayEnd = i
        break
      }
    }
  }
  
  if (arrayEnd === -1) return null

  const jsonSlice = candidate.slice(arrayStart, arrayEnd + 1)
  try {
    const parsed: unknown = JSON.parse(jsonSlice)
    if (!Array.isArray(parsed)) return null

    const specs: ParsedTaskSpec[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>
      if (typeof obj['title'] !== 'string') continue
      if (typeof obj['description'] !== 'string') continue

      specs.push({
        title: obj['title'],
        description: obj['description'],
        assignee: typeof obj['assignee'] === 'string' ? obj['assignee'] : undefined,
        dependsOn: Array.isArray(obj['dependsOn'])
          ? (obj['dependsOn'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined,
      })
    }

    return specs.length > 0 ? specs : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Run ID generation
// ---------------------------------------------------------------------------

export function generateRunId(): string {
  return `run_${Date.now()}_${randomUUID().slice(0, 8)}`
}
