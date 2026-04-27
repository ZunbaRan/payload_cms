/**
 * @fileoverview AgentLogEvent → Payload trace sink
 *
 * 把 ClaudeAgent 实时事件落库到 pipeline-trace-events / pipeline-tool-calls。
 * 设计为非阻塞：失败只记 warn，不影响 agent 主流程。
 *
 * 事件 schema 来源：workflow/core/agent/claude-agent.ts#dispatchLogEvent
 *   types: system_init | assistant_text | tool_call | tool_result
 *        | tool_progress | result | process_cleanup | unknown
 */

import type { Payload } from 'payload'

export type AgentLogEvent = {
  agentName: string
  type:
    | 'system_init' | 'assistant_text' | 'tool_call' | 'tool_result'
    | 'tool_progress' | 'result' | 'process_cleanup' | 'unknown'
  data: Record<string, unknown>
}

export interface TracerStats {
  costUsd: number
  tokensIn: number
  tokensOut: number
  sessionId?: string
}

export function makeTracerSink(payload: Payload, invocationId: string) {
  const startMs = Date.now()
  const inflight = new Map<string, string>()
  const stats: TracerStats = { costUsd: 0, tokensIn: 0, tokensOut: 0 }

  const sink = async (event: AgentLogEvent): Promise<void> => {
    const elapsedMs = Date.now() - startMs
    try {
      await payload.create({
        collection: 'pipeline-trace-events',
        data: {
          invocation: invocationId,
          type: event.type as any,
          elapsedMs,
          data: event.data as any,
        },
      })

      switch (event.type) {
        case 'system_init': {
          const sid = event.data.session_id as string | undefined
          if (sid) stats.sessionId = sid
          break
        }
        case 'tool_call': {
          const id = event.data.tool_id as string | undefined
          const name = event.data.tool_name as string | undefined
          if (!id || !name) break
          const created = await payload.create({
            collection: 'pipeline-tool-calls',
            data: {
              invocation: invocationId,
              toolName: name,
              inputSummary: summarise(event.data.input),
              startedAt: new Date(),
            },
          })
          inflight.set(id, created.id as string)
          break
        }
        case 'tool_result': {
          const id = event.data.parent_tool_use_id as string | undefined
          if (!id) break
          const tcId = inflight.get(id)
          if (!tcId) break
          await payload.update({
            collection: 'pipeline-tool-calls',
            id: tcId,
            data: {
              outputSummary: String(event.data.result ?? '').slice(0, 2000),
              isError: false,
              durationMs: elapsedMs,
            },
          })
          inflight.delete(id)
          break
        }
        case 'result': {
          stats.costUsd = (event.data.cost_usd as number) ?? stats.costUsd
          stats.tokensIn = (event.data.input_tokens as number) ?? stats.tokensIn
          stats.tokensOut = (event.data.output_tokens as number) ?? stats.tokensOut
          break
        }
      }
    } catch (err) {
      payload.logger.warn(`[coding-pipeline] tracer sink failed: ${err}`)
    }
  }

  return { sink, stats }
}

function summarise(input: unknown): string {
  if (typeof input !== 'object' || input === null) return String(input).slice(0, 500)
  try {
    const s = JSON.stringify(input)
    return s.length > 500 ? s.slice(0, 497) + '...' : s
  } catch {
    return '<unserialisable>'
  }
}
