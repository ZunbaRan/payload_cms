/**
 * @fileoverview Structured output utilities — JSON extraction and Zod validation.
 * Extracted from the original src/agent/structured-output.ts.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { type ZodSchema } from 'zod'
import type { LLMMessage } from '../shared-types.js'

/**
 * Attempt to extract and parse JSON from the agent's raw text output.
 */
export function extractJSON(raw: string): unknown {
  const trimmed = raw.trim()

  try { return JSON.parse(trimmed) } catch { /* continue */ }

  const jsonFenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/)
  if (jsonFenceMatch?.[1]) {
    try { return JSON.parse(jsonFenceMatch[1].trim()) } catch { /* continue */ }
  }

  const bareFenceMatch = trimmed.match(/```\s*([\s\S]*?)```/)
  if (bareFenceMatch?.[1]) {
    try { return JSON.parse(bareFenceMatch[1].trim()) } catch { /* continue */ }
  }

  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(trimmed.slice(objStart, objEnd + 1)) } catch { /* continue */ }
  }

  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)) } catch { /* continue */ }
  }

  // 6. Repair malformed JSON (unescaped quotes, trailing commas, comments)
  try { return repairJSON(trimmed) } catch { /* continue */ }

  throw new Error(`Failed to extract JSON. Raw output begins with: "${trimmed.slice(0, 100)}"`)
}

/**
 * Attempt to repair common LLM JSON output issues:
 * - Unescaped double quotes inside string values (e.g. "用"缰绳"驾驭")
 * - Trailing commas before ] or }
 * - Single-line // comments
 * - Chinese curly quotes used as delimiters
 */
export function repairJSON(raw: string): unknown {
  let s = raw

  // Strip markdown fences
  s = s.replace(/```json\s*/g, '').replace(/```\s*/g, '')

  // Extract outermost {...} or [...]
  const objStart = s.indexOf('{')
  const objEnd = s.lastIndexOf('}')
  const arrStart = s.indexOf('[')
  const arrEnd = s.lastIndexOf(']')

  if (objStart !== -1 && objEnd > objStart) {
    s = s.slice(objStart, objEnd + 1)
  } else if (arrStart !== -1 && arrEnd > arrStart) {
    s = s.slice(arrStart, arrEnd + 1)
  } else {
    throw new Error('No JSON object or array found')
  }

  // Remove single-line comments
  s = s.replace(/\/\/[^\n]*/g, '')

  // Remove trailing commas: ,] or ,}
  s = s.replace(/,\s*([\]}])/g, '$1')

  // Replace Chinese curly quotes used as JSON delimiters
  // "\u201c and \u201d" → standard quotes — but only when they appear as string delimiters
  // This is tricky: we only replace them at key/value boundaries
  s = s.replace(/"\s*:\s*\u201c/g, '": "').replace(/\u201d\s*([,}\]])/g, '"$1')
  s = s.replace(/"\s*:\s*\u201c/g, '": "').replace(/\u201d\s*$/gm, '"')

  // Try parsing after basic fixes
  try { return JSON.parse(s) } catch { /* continue to quote repair */ }

  // Fix unescaped double quotes inside string values.
  // Strategy: process line by line, find "key": "value" patterns,
  // and escape any internal quotes in the value portion.
  s = fixUnescapedQuotes(s)

  // Remove trailing commas again (quote fixing may have shifted things)
  s = s.replace(/,\s*([\]}])/g, '$1')

  return JSON.parse(s)
}

/**
 * Fix unescaped double quotes inside JSON string values.
 *
 * For each line matching `"key": "value",` pattern, we:
 * 1. Find the value portion (after the colon's opening quote)
 * 2. Escape any unescaped double quotes inside the value
 */
function fixUnescapedQuotes(json: string): string {
  // Match lines like:  "key": "...value..."
  // Capture: indent + "key": " ... value ... " trailing
  return json.replace(
    /^(\s*"[^"]*"\s*:\s*")(.*)(",?\s*)$/gm,
    (_match, prefix: string, value: string, suffix: string) => {
      // The value portion may contain unescaped quotes
      // Escape any " that isn't already escaped (not preceded by \)
      const fixed = value.replace(/(?<!\\)"/g, '\\"')
      return prefix + fixed + suffix
    },
  )
}

/**
 * Validate a parsed JSON value against a Zod schema.
 */
export function validateOutput(schema: ZodSchema, data: unknown): unknown {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issues = result.error.issues
    .map(i => `  - ${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(`Output validation failed:\n${issues}`)
}

/**
 * Use an agent runner to extract structured JSON from unstructured text.
 *
 * This is the foundational primitive for LLM-based JSON extraction:
 * the caller supplies a `runFn` that invokes any agent/LLM with a prompt
 * and returns the raw text output. The result is then parsed via `extractJSON`.
 *
 * Keeping agent-creation concerns outside this function means it stays
 * testable and reusable across pipeline stages and runtimes.
 *
 * @param runFn - Async function that sends `prompt` to an LLM and returns raw text
 * @param prompt - The extraction prompt (should instruct the LLM to output only JSON)
 * @returns Parsed JSON value
 * @throws If the runner throws, or if `extractJSON` cannot find valid JSON in the output
 */
export async function extractJSONWithAgent(
  runFn: (prompt: string) => Promise<string>,
  prompt: string,
): Promise<unknown> {
  const output = await runFn(prompt)
  return extractJSON(output)
}

// ---------------------------------------------------------------------------
// Higher-level extraction helpers — recover JSON from LLM run artefacts.
// All helpers funnel through `extractJSON`, so they automatically benefit
// from `repairJSON` (unescaped quotes, trailing commas, Chinese curly quotes).
// ---------------------------------------------------------------------------

/**
 * Try to parse a string as JSON; on failure run `extractJSON` (which includes
 * repair). Returns `null` if every strategy fails.
 */
export function tryParseJSON<T = unknown>(raw: string): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { /* try repair */ }
  try { return extractJSON(raw) as T } catch { return null }
}

/**
 * Read a JSON file from disk and parse it. Falls back to `extractJSON` (with
 * repair) if `JSON.parse` rejects the content. Returns `null` if the file is
 * absent or cannot be salvaged.
 */
export function readJSONFileSafe<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    return tryParseJSON<T>(raw)
  } catch {
    return null
  }
}

/**
 * Walk an LLM message history (newest first) and pull JSON out of any
 * assistant text block. Useful when the model echoes the answer in a
 * non-final turn before continuing.
 */
export function extractJSONFromMessages<T = unknown>(
  messages: ReadonlyArray<LLMMessage>,
): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'assistant') continue

    for (const block of msg.content) {
      if (block.type !== 'text') continue
      const text = (block as { text?: string }).text
      if (!text) continue
      const parsed = tryParseJSON<T>(text)
      if (parsed !== null) return parsed
    }
  }
  return null
}

/** Tool-call shape produced by ClaudeAgent runs. */
export interface ToolCallRecord {
  readonly toolName: string
  readonly input: Record<string, unknown>
}

/**
 * Scan the tool-call log (newest first) for a `Write` (or compatible) call
 * targeting a file whose basename matches `expectedBasename` and parse the
 * `content` payload as JSON.
 *
 * This recovers the structured payload even when the model's final text
 * output is just a summary like "Saved to curriculum.json".
 */
export function extractJSONFromWriteToolCalls<T = unknown>(
  toolCalls: ReadonlyArray<ToolCallRecord>,
  expectedBasename: string,
): T | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i]
    if (!call) continue
    if (call.toolName !== 'Write') continue

    const filePath = typeof call.input.file_path === 'string'
      ? call.input.file_path
      : typeof call.input.filePath === 'string'
        ? call.input.filePath
        : ''
    if (!filePath || path.basename(filePath) !== expectedBasename) continue

    const content = typeof call.input.content === 'string' ? call.input.content : ''
    if (!content) continue

    const parsed = tryParseJSON<T>(content)
    if (parsed !== null) return parsed
  }
  return null
}
