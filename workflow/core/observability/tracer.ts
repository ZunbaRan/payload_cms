/**
 * @fileoverview Pipeline Tracer — structured event collection for multi-agent pipelines.
 *
 * Every pipeline run gets a unique `runId`. Each agent within the pipeline emits
 * structured events (start, message, tool_call, result, error) that the tracer
 * collects. Events can be:
 *
 * - Queried in real-time via {@link PipelineTracer.getAgentTrace}
 * - Streamed via the `onEvent` callback
 * - Exported to JSON via {@link PipelineTracer.toJSON}
 * - Displayed in TUI via the dashboard module
 *
 * @example
 * ```ts
 * const tracer = new PipelineTracer('my-pipeline')
 * const agentTracer = tracer.agent('researcher')
 * agentTracer.start({ model: 'claude-sonnet-4-6', prompt: '...' })
 * agentTracer.toolCall('Read', { file_path: '/src/index.ts' }, 120)
 * agentTracer.result({ success: true, output: '...', costUsd: 0.02, tokens: { in: 1000, out: 500 } })
 * console.log(tracer.summary())
 * ```
 */

import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trace event types */
export type TraceEventType =
  | 'agent_start'
  | 'agent_text'
  | 'agent_tool_call'
  | 'agent_tool_result'
  | 'agent_result'
  | 'agent_error'
  | 'pipeline_start'
  | 'pipeline_step'
  | 'pipeline_complete'
  | 'pipeline_error'

/** A single trace event */
export interface TraceEvent {
  /** Unique event ID */
  readonly id: string
  /** Pipeline run ID (shared by all events in one pipeline execution) */
  readonly runId: string
  /** Event type */
  readonly type: TraceEventType
  /** Agent name (empty for pipeline-level events) */
  readonly agentName: string
  /** Timestamp (ISO 8601) */
  readonly timestamp: string
  /** Milliseconds since pipeline start */
  readonly elapsedMs: number
  /** Event-specific payload */
  readonly data: Record<string, unknown>
}

/** Per-agent execution summary */
export interface AgentTraceSummary {
  readonly agentName: string
  readonly status: 'idle' | 'running' | 'completed' | 'error'
  readonly startedAt?: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly model?: string
  readonly inputPrompt?: string
  readonly outputText?: string
  readonly costUsd?: number
  readonly tokenUsage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  readonly toolCalls: Array<{
    tool: string
    input: Record<string, unknown>
    durationMs: number
  }>
  readonly events: readonly TraceEvent[]
  /** Configuration snapshot (tools, skills, permissions, etc.) */
  readonly config?: Record<string, unknown>
}

/** Full pipeline run summary */
export interface PipelineRunSummary {
  readonly runId: string
  readonly pipelineName: string
  readonly status: 'running' | 'completed' | 'error'
  readonly startedAt: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly totalCostUsd: number
  readonly totalTokens: { input: number; output: number }
  readonly agents: readonly AgentTraceSummary[]
  readonly steps: readonly string[]
}

/** Callback for real-time event streaming */
export type TraceListener = (event: TraceEvent) => void

// ---------------------------------------------------------------------------
// AgentTracer — per-agent event recorder
// ---------------------------------------------------------------------------

/**
 * Records events for a single agent within a pipeline run.
 *
 * Created via {@link PipelineTracer.agent} — not instantiated directly.
 */
export class AgentTracer {
  readonly agentName: string

  private _status: 'idle' | 'running' | 'completed' | 'error' = 'idle'
  private _startedAt?: string
  private _completedAt?: string
  private _model?: string
  private _inputPrompt?: string
  private _outputText?: string
  private _costUsd?: number
  private _tokenUsage?: AgentTraceSummary['tokenUsage']
  private _config?: Record<string, unknown>
  private readonly _toolCalls: AgentTraceSummary['toolCalls'][number][] = []
  private readonly _events: TraceEvent[] = []

  constructor(
    agentName: string,
    private readonly runId: string,
    private readonly pipelineStartMs: number,
    private readonly emit: (event: TraceEvent) => void,
  ) {
    this.agentName = agentName
  }

  /** Record agent start */
  start(config?: Record<string, unknown>): void {
    this._status = 'running'
    this._startedAt = new Date().toISOString()
    this._config = config
    this._inputPrompt = config?.prompt as string | undefined
    this._model = config?.model as string | undefined
    this.push('agent_start', {
      model: config?.model,
      tools: config?.tools,
      skills: config?.skills,
      permissionMode: config?.permissionMode,
      cwd: config?.cwd,
    })
  }

  /** Record assistant text output */
  text(content: string): void {
    this.push('agent_text', { text: content.slice(0, 500) })
  }

  /** Record a tool call */
  toolCall(tool: string, input: Record<string, unknown>, durationMs = 0): void {
    this._toolCalls.push({ tool, input, durationMs })
    this.push('agent_tool_call', { tool, input: truncateObj(input), durationMs })
  }

  /** Record tool result */
  toolResult(toolId: string, output: string): void {
    this.push('agent_tool_result', { toolId, output: output.slice(0, 300) })
  }

  /** Record successful completion */
  result(data: {
    success: boolean
    output: string
    costUsd?: number
    tokens?: { in: number; out: number; cacheRead?: number; cacheCreate?: number }
  }): void {
    this._status = data.success ? 'completed' : 'error'
    this._completedAt = new Date().toISOString()
    this._outputText = data.output
    this._costUsd = data.costUsd
    if (data.tokens) {
      this._tokenUsage = {
        input_tokens: data.tokens.in,
        output_tokens: data.tokens.out,
        cache_read_input_tokens: data.tokens.cacheRead,
        cache_creation_input_tokens: data.tokens.cacheCreate,
      }
    }
    this.push('agent_result', {
      success: data.success,
      output: data.output.slice(0, 500),
      costUsd: data.costUsd,
      tokens: data.tokens,
    })
  }

  /** Record error */
  error(err: Error | string): void {
    this._status = 'error'
    this._completedAt = new Date().toISOString()
    const message = err instanceof Error ? err.message : err
    this.push('agent_error', { error: message })
  }

  /** Get current status */
  get status() { return this._status }

  /** Produce summary snapshot */
  toSummary(): AgentTraceSummary {
    const durationMs =
      this._startedAt && this._completedAt
        ? new Date(this._completedAt).getTime() - new Date(this._startedAt).getTime()
        : undefined
    return {
      agentName: this.agentName,
      status: this._status,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      durationMs,
      model: this._model,
      inputPrompt: this._inputPrompt,
      outputText: this._outputText,
      costUsd: this._costUsd,
      tokenUsage: this._tokenUsage,
      toolCalls: [...this._toolCalls],
      events: [...this._events],
      config: this._config,
    }
  }

  private push(type: TraceEventType, data: Record<string, unknown>): void {
    const event: TraceEvent = {
      id: randomUUID(),
      runId: this.runId,
      type,
      agentName: this.agentName,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.pipelineStartMs,
      data,
    }
    this._events.push(event)
    this.emit(event)
  }
}

// ---------------------------------------------------------------------------
// PipelineTracer — pipeline-level event recorder
// ---------------------------------------------------------------------------

/**
 * Central tracer for a pipeline run.
 *
 * @example
 * ```ts
 * const tracer = new PipelineTracer('course-explainer')
 *
 * // Optional: stream events to external system
 * tracer.onEvent((event) => sendToOTLP(event))
 *
 * // Create per-agent tracers
 * const teacher = tracer.agent('teacher')
 * const learner = tracer.agent('learner')
 *
 * // ... run agents ...
 *
 * // Get full summary
 * console.log(JSON.stringify(tracer.summary(), null, 2))
 * ```
 */
export class PipelineTracer {
  readonly runId: string
  readonly pipelineName: string
  readonly startedAt: string

  private _status: 'running' | 'completed' | 'error' = 'running'
  private _completedAt?: string
  private readonly _startMs = Date.now()
  private readonly _agents = new Map<string, AgentTracer>()
  private readonly _steps: string[] = []
  private readonly _allEvents: TraceEvent[] = []
  private readonly _listeners: TraceListener[] = []

  constructor(pipelineName: string, runId?: string) {
    this.runId = runId ?? randomUUID()
    this.pipelineName = pipelineName
    this.startedAt = new Date().toISOString()
    this.pushPipelineEvent('pipeline_start', { pipelineName })
  }

  /** Register a real-time event listener */
  onEvent(listener: TraceListener): void {
    this._listeners.push(listener)
  }

  /** Create or retrieve a per-agent tracer */
  agent(agentName: string): AgentTracer {
    let at = this._agents.get(agentName)
    if (!at) {
      at = new AgentTracer(agentName, this.runId, this._startMs, (e) => this.handleEvent(e))
      this._agents.set(agentName, at)
    }
    return at
  }

  /** Record a pipeline step (e.g. "Phase 1: Clarity", "Phase 2: Engagement") */
  step(label: string): void {
    this._steps.push(label)
    this.pushPipelineEvent('pipeline_step', { step: label })
  }

  /** Mark pipeline as completed */
  complete(): void {
    this._status = 'completed'
    this._completedAt = new Date().toISOString()
    this.pushPipelineEvent('pipeline_complete', this.buildSummaryData())
  }

  /** Mark pipeline as errored */
  error(err: Error | string): void {
    this._status = 'error'
    this._completedAt = new Date().toISOString()
    const message = err instanceof Error ? err.message : err
    this.pushPipelineEvent('pipeline_error', { error: message })
  }

  /** Get the trace for a specific agent */
  getAgentTrace(agentName: string): AgentTraceSummary | undefined {
    return this._agents.get(agentName)?.toSummary()
  }

  /** Get all events (for export) */
  get events(): readonly TraceEvent[] {
    return this._allEvents
  }

  /** Get live agent tracers (for dashboard) */
  get agents(): ReadonlyMap<string, AgentTracer> {
    return this._agents
  }

  /** Produce full pipeline run summary */
  summary(): PipelineRunSummary {
    const agentSummaries = Array.from(this._agents.values()).map(a => a.toSummary())
    const totalCostUsd = agentSummaries.reduce((s, a) => s + (a.costUsd ?? 0), 0)
    const totalTokens = agentSummaries.reduce(
      (s, a) => ({
        input: s.input + (a.tokenUsage?.input_tokens ?? 0),
        output: s.output + (a.tokenUsage?.output_tokens ?? 0),
      }),
      { input: 0, output: 0 },
    )

    return {
      runId: this.runId,
      pipelineName: this.pipelineName,
      status: this._status,
      startedAt: this.startedAt,
      completedAt: this._completedAt,
      durationMs: this._completedAt
        ? new Date(this._completedAt).getTime() - this._startMs
        : Date.now() - this._startMs,
      totalCostUsd,
      totalTokens,
      agents: agentSummaries,
      steps: [...this._steps],
    }
  }

  /** Export to JSON string */
  toJSON(): string {
    return JSON.stringify({
      summary: this.summary(),
      events: this._allEvents,
    }, null, 2)
  }

  private handleEvent(event: TraceEvent): void {
    this._allEvents.push(event)
    for (const listener of this._listeners) {
      try { listener(event) } catch { /* don't break the pipeline */ }
    }
  }

  private pushPipelineEvent(type: TraceEventType, data: Record<string, unknown>): void {
    const event: TraceEvent = {
      id: randomUUID(),
      runId: this.runId,
      type,
      agentName: '',
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this._startMs,
      data,
    }
    this.handleEvent(event)
  }

  private buildSummaryData(): Record<string, unknown> {
    const s = this.summary()
    return {
      durationMs: s.durationMs,
      totalCostUsd: s.totalCostUsd,
      totalTokens: s.totalTokens,
      agentCount: s.agents.length,
      steps: s.steps,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an `onEvent` callback for ClaudeAgent that feeds into a tracer.
 *
 * Usage:
 * ```ts
 * const tracer = new PipelineTracer('my-pipeline')
 * const agent = new ClaudeAgent(config, {
 *   onEvent: createTracerCallback(tracer, 'researcher'),
 * })
 * ```
 */
export function createTracerCallback(
  tracer: PipelineTracer,
  agentName: string,
): (event: { agentName: string; type: string; data: Record<string, unknown> }) => void {
  const at = tracer.agent(agentName)
  return (event) => {
    switch (event.type) {
      case 'system_init':
        at.start(event.data)
        break
      case 'assistant_text':
        at.text(event.data.text as string ?? '')
        break
      case 'tool_call':
        at.toolCall(
          event.data.tool_name as string ?? 'unknown',
          event.data.input as Record<string, unknown> ?? {},
        )
        break
      case 'tool_result':
        at.toolResult(
          event.data.parent_tool_use_id as string ?? '',
          event.data.result as string ?? '',
        )
        break
      case 'result': {
        const d = event.data
        at.result({
          success: !(d.is_error as boolean),
          output: d.result as string ?? '',
          costUsd: d.cost_usd as number | undefined,
          tokens: d.input_tokens != null
            ? { in: d.input_tokens as number, out: d.output_tokens as number ?? 0 }
            : undefined,
        })
        break
      }
    }
  }
}

function truncateObj(obj: Record<string, unknown>, maxLen = 200): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > maxLen) {
      result[k] = v.slice(0, maxLen) + '...'
    } else {
      result[k] = v
    }
  }
  return result
}
