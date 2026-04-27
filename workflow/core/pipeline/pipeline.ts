/**
 * @fileoverview Simplified Pipeline builder for multi-agent workflows.
 *
 * Provides a clean, fluent API for defining serial and parallel agent steps,
 * each with fully isolated configuration (tools, skills, permissions, cwd, etc.).
 * Automatically wires into {@link PipelineTracer} for end-to-end observability.
 *
 * @example
 * ```ts
 * import { Pipeline } from './pipeline.js'
 *
 * const result = await new Pipeline('write-article')
 *   .step('researcher', {
 *     systemPrompt: 'You are a researcher.',
 *     tools: ['Read', 'Grep', 'Glob'],
 *   })
 *   .step('writer', {
 *     systemPrompt: 'You are a writer. Use the research below to write an article.',
 *     tools: ['Write', 'Edit'],
 *   })
 *   .run('Write an article about TypeScript generics')
 *
 * console.log(result.finalOutput)
 * console.log(result.tracer.summary())
 * ```
 */

import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions, AgentLogEvent } from '../agent/claude-agent.js'
import type { AgentConfig } from '../shared-types.js'
import { PipelineTracer, createTracerCallback } from '../observability/tracer.js'
import type { PipelineRunSummary } from '../observability/tracer.js'
import type { HookEvent, HookCallbackMatcher, SdkPluginConfig } from '../agent/claude-agent.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single pipeline step. */
export interface StepConfig {
  /** Agent name (unique within pipeline). */
  readonly name: string
  /** Model override. */
  readonly model?: string
  /** System prompt for this agent. */
  readonly systemPrompt?: string
  /** Tools to allow (SDK built-in names). */
  readonly tools?: string[]
  /** Tools to deny. */
  readonly disallowedTools?: string[]
  /** Permission mode. */
  readonly permissionMode?: ClaudeAgentOptions['permissionMode']
  /** Working directory for this agent. */
  readonly cwd?: string
  /** Max agentic turns. */
  readonly maxTurns?: number
  /** Max budget in USD. */
  readonly maxBudgetUsd?: number
  /** Timeout in milliseconds. */
  readonly timeoutMs?: number
  /** MCP servers for this agent. */
  readonly mcpServers?: Record<string, unknown>
  /** SubAgent definitions. */
  readonly agents?: Record<string, unknown>
  /** Lifecycle hooks (see HookCallbackMatcher). */
  readonly hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
  /** Local plugins to load for this agent. */
  readonly plugins?: SdkPluginConfig[]
  /** Skills to deny. */
  readonly deniedSkills?: string[]
  /** Skills to allow (whitelist — only these skills will be loaded into agent context). */
  readonly allowedSkills?: string[]
  /** Settings sources (controls skill loading). */
  readonly settingSources?: Array<'project' | 'user' | 'local'>
  /** canUseTool callback. */
  readonly canUseTool?: (toolName: string, input: unknown) => Promise<boolean>
  /** Disable MCP tools. */
  readonly disableMcp?: boolean
  /** Thinking configuration. */
  readonly thinking?: { type: 'adaptive' | 'enabled' | 'disabled'; budgetTokens?: number }
  /** Effort level. */
  readonly effort?: 'low' | 'medium' | 'high' | 'max'
  /** Whether to inject network/CDP rules into system prompt (default: true). */
  readonly injectNetworkRule?: boolean
  /** Custom environment variables. */
  readonly env?: Record<string, string | undefined>
  /** Path to Claude Code executable. */
  readonly pathToClaudeCodeExecutable?: string
  /**
   * Prompt template or function.
   *
   * - String: `{{goal}}` is replaced with the pipeline goal,
   *   `{{prev}}` with the previous step's output.
   * - Function: receives full context and returns the prompt string.
   *
   * If omitted, defaults to:
   *   - First step: the pipeline goal.
   *   - Subsequent steps: goal + previous step output.
   */
  readonly prompt?: string | ((ctx: StepContext) => string | Promise<string>)
}

/** Context available to prompt functions. */
export interface StepContext {
  /** The original pipeline goal. */
  readonly goal: string
  /** Name of the current step. */
  readonly stepName: string
  /** Output of the previous step (empty string for first step). */
  readonly prevOutput: string
  /** All previous outputs keyed by step name. */
  readonly outputs: ReadonlyMap<string, string>
  /** Current step index (0-based). */
  readonly stepIndex: number
}

/** Parallel step group: all agents run concurrently, results merged. */
export interface ParallelGroup {
  readonly type: 'parallel'
  readonly label: string
  readonly steps: StepConfig[]
}

/** A pipeline entry is either a single step or a parallel group. */
type PipelineEntry =
  | { type: 'step'; config: StepConfig }
  | ParallelGroup

/** Result of a pipeline run. */
export interface PipelineResult {
  /** Whether all steps succeeded. */
  readonly success: boolean
  /** Output of the final step. */
  readonly finalOutput: string
  /** All step outputs keyed by agent name. */
  readonly outputs: ReadonlyMap<string, string>
  /** Pipeline tracer with full observability data. */
  readonly tracer: PipelineTracer
  /** Full summary snapshot. */
  readonly summary: PipelineRunSummary
  /** Errors (if any). */
  readonly errors: ReadonlyArray<{ step: string; error: string }>
}

/** Pipeline-level options. */
export interface PipelineOptions {
  /** Maximum concurrent agents in parallel groups (default: 5). */
  readonly maxConcurrency?: number
  /** Custom tracer (if not provided, one is created). */
  readonly tracer?: PipelineTracer
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal
  /** Callback for real-time trace events. */
  readonly onEvent?: (event: AgentLogEvent) => void
  /** Base ClaudeAgentOptions applied to all steps (step config overrides). */
  readonly defaults?: Partial<StepConfig>
  /**
   * Path to a `.env` file for this pipeline.
   *
   * Environment variables from this file are merged as `env` into every agent.
   * Step-level `env` overrides pipeline-level values.
   * If omitted, no extra `.env` is loaded (agents use process.env as usual).
   */
  readonly envFile?: string
}

// ---------------------------------------------------------------------------
// .env file loader
// ---------------------------------------------------------------------------

/** Parse a `.env` file into a key-value map. Skips comments and blank lines. */
function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const result: Record<string, string> = {}
  const content = fs.readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Pipeline class
// ---------------------------------------------------------------------------

/**
 * Fluent builder for multi-agent pipelines.
 *
 * Each step creates an isolated {@link ClaudeAgent} with its own configuration.
 * The tracer automatically collects events from every agent.
 */
export class Pipeline {
  readonly name: string
  private readonly _entries: PipelineEntry[] = []
  private _options: PipelineOptions = {}

  constructor(name: string) {
    this.name = name
  }

  /**
   * Append a serial step.
   *
   * @param name - Unique step/agent name.
   * @param config - Agent configuration (omit `name`, it's set from the first arg).
   */
  step(name: string, config: Omit<StepConfig, 'name'> = {}): this {
    this._entries.push({
      type: 'step',
      config: { ...config, name },
    })
    return this
  }

  /**
   * Append a group of steps that execute in parallel.
   *
   * @param label - Label for this parallel phase.
   * @param steps - Steps to run concurrently.
   */
  parallel(label: string, steps: StepConfig[]): this {
    this._entries.push({ type: 'parallel', label, steps })
    return this
  }

  /**
   * Set pipeline-level options.
   */
  options(opts: PipelineOptions): this {
    this._options = { ...this._options, ...opts }
    return this
  }

  /**
   * Execute the pipeline.
   *
   * @param goal - The top-level goal/prompt for the pipeline.
   */
  async run(goal: string): Promise<PipelineResult> {
    const tracer = this._options.tracer ?? new PipelineTracer(this.name)
    const outputs = new Map<string, string>()
    const errors: Array<{ step: string; error: string }> = []
    let prevOutput = ''
    let lastOutput = ''

    try {
      for (let i = 0; i < this._entries.length; i++) {
        // Check cancellation
        if (this._options.signal?.aborted) {
          throw new Error('Pipeline aborted')
        }

        const entry = this._entries[i]!

        if (entry.type === 'step') {
          tracer.step(`${entry.config.name}`)
          const result = await this.runStep(
            entry.config, goal, prevOutput, outputs, i, tracer,
          )
          if (result.success) {
            outputs.set(entry.config.name, result.output)
            prevOutput = result.output
            lastOutput = result.output
          } else {
            errors.push({ step: entry.config.name, error: result.output })
            // Continue to next step with error output
            outputs.set(entry.config.name, `[ERROR] ${result.output}`)
            prevOutput = result.output
          }
        } else {
          // Parallel group
          tracer.step(`parallel: ${entry.label}`)
          const results = await this.runParallel(
            entry.steps, goal, prevOutput, outputs, i, tracer,
          )

          const combinedOutputs: string[] = []
          for (const [name, result] of results) {
            if (result.success) {
              outputs.set(name, result.output)
              combinedOutputs.push(`### ${name}\n${result.output}`)
            } else {
              errors.push({ step: name, error: result.output })
              outputs.set(name, `[ERROR] ${result.output}`)
            }
          }
          prevOutput = combinedOutputs.join('\n\n')
          lastOutput = prevOutput
        }
      }

      tracer.complete()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      tracer.error(message)
      errors.push({ step: '__pipeline__', error: message })
    }

    return {
      success: errors.length === 0,
      finalOutput: lastOutput,
      outputs,
      tracer,
      summary: tracer.summary(),
      errors,
    }
  }

  // -------------------------------------------------------------------------
  // Internal execution
  // -------------------------------------------------------------------------

  private async runStep(
    config: StepConfig,
    goal: string,
    prevOutput: string,
    outputs: ReadonlyMap<string, string>,
    stepIndex: number,
    tracer: PipelineTracer,
  ): Promise<{ success: boolean; output: string }> {
    const prompt = await this.resolvePrompt(config, goal, prevOutput, outputs, stepIndex)
    const agent = this.createAgent(config, tracer)

    try {
      const result = await agent.run(prompt, {
        signal: this._options.signal,
      })
      return { success: result.success, output: result.output }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      tracer.agent(config.name).error(message)
      return { success: false, output: message }
    }
  }

  private async runParallel(
    steps: StepConfig[],
    goal: string,
    prevOutput: string,
    outputs: ReadonlyMap<string, string>,
    stepIndex: number,
    tracer: PipelineTracer,
  ): Promise<Map<string, { success: boolean; output: string }>> {
    const maxConcurrency = this._options.maxConcurrency ?? 5
    const results = new Map<string, { success: boolean; output: string }>()
    const remaining = [...steps]

    // Simple semaphore for concurrency control
    const running: Promise<void>[] = []

    const runOne = async (stepConfig: StepConfig) => {
      const result = await this.runStep(
        stepConfig, goal, prevOutput, outputs, stepIndex, tracer,
      )
      results.set(stepConfig.name, result)
    }

    while (remaining.length > 0 || running.length > 0) {
      // Fill up to maxConcurrency
      while (remaining.length > 0 && running.length < maxConcurrency) {
        const stepConfig = remaining.shift()!
        const promise = runOne(stepConfig).then(() => {
          const idx = running.indexOf(promise)
          if (idx >= 0) running.splice(idx, 1)
        })
        running.push(promise)
      }

      // Wait for at least one to complete
      if (running.length > 0) {
        await Promise.race(running)
      }
    }

    return results
  }

  private async resolvePrompt(
    config: StepConfig,
    goal: string,
    prevOutput: string,
    outputs: ReadonlyMap<string, string>,
    stepIndex: number,
  ): Promise<string> {
    const ctx: StepContext = {
      goal,
      stepName: config.name,
      prevOutput,
      outputs,
      stepIndex,
    }

    // Custom prompt function
    if (typeof config.prompt === 'function') {
      return config.prompt(ctx)
    }

    // Template string
    if (typeof config.prompt === 'string') {
      return config.prompt
        .replace(/\{\{goal\}\}/g, goal)
        .replace(/\{\{prev\}\}/g, prevOutput)
    }

    // Default: first step gets goal, subsequent steps get goal + prev output
    if (stepIndex === 0 || !prevOutput) {
      return goal
    }

    return [
      goal,
      '',
      '---',
      '',
      'Previous step output:',
      prevOutput,
    ].join('\n')
  }

  private createAgent(config: StepConfig, tracer: PipelineTracer): ClaudeAgent {
    const defaults = this._options.defaults ?? {}

    // Merge defaults with step config (step overrides defaults)
    const merged = { ...defaults, ...config }

    // Load pipeline-level .env file if configured
    const pipelineEnv = this._options.envFile
      ? loadEnvFile(this._options.envFile)
      : {}

    // Merge env: pipelineEnv < defaults.env < step.env (step wins)
    const mergedEnv: Record<string, string | undefined> = {
      ...pipelineEnv,
      ...(defaults.env ?? {}),
      ...(config.env ?? {}),
    }

    const agentConfig: AgentConfig = {
      name: merged.name,
      model: merged.model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6',
      systemPrompt: merged.systemPrompt,
      tools: merged.tools,
      maxTurns: merged.maxTurns,
      timeoutMs: merged.timeoutMs,
    }

    const sdkOptions: ClaudeAgentOptions = {
      cwd: merged.cwd,
      env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
      model: merged.model,
      maxTurns: merged.maxTurns,
      maxBudgetUsd: merged.maxBudgetUsd,
      timeoutMs: merged.timeoutMs,
      mcpServers: merged.mcpServers as Record<string, any> | undefined,
      agents: merged.agents as Record<string, any> | undefined,
      hooks: merged.hooks,
      plugins: merged.plugins ? [...merged.plugins] : undefined,
      permissionMode: merged.permissionMode,
      allowedTools: merged.tools ? [...merged.tools] : undefined,
      disallowedTools: merged.disallowedTools ? [...merged.disallowedTools] : undefined,
      deniedSkills: merged.deniedSkills ? [...merged.deniedSkills] : undefined,
      allowedSkills: merged.allowedSkills ? [...merged.allowedSkills] : undefined,
      settingSources: merged.settingSources ? [...merged.settingSources] : undefined,
      canUseTool: merged.canUseTool,
      disableMcp: merged.disableMcp,
      thinking: merged.thinking,
      effort: merged.effort,
      injectNetworkRule: merged.injectNetworkRule,
      pathToClaudeCodeExecutable: merged.pathToClaudeCodeExecutable,
      // Wire tracer: merge user onEvent with tracer callback
      onEvent: this.buildOnEvent(config.name, tracer),
    }

    return new ClaudeAgent(agentConfig, sdkOptions)
  }

  private buildOnEvent(
    agentName: string,
    tracer: PipelineTracer,
  ): (event: AgentLogEvent) => void {
    const tracerCb = createTracerCallback(tracer, agentName)
    const userCb = this._options.onEvent

    return (event: AgentLogEvent) => {
      // Feed into tracer
      tracerCb(event)
      // Forward to user callback
      if (userCb) {
        try { userCb(event) } catch { /* don't break pipeline */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create and immediately run a simple serial pipeline.
 *
 * @example
 * ```ts
 * const result = await runPipeline('summarize', 'Summarize this codebase', [
 *   { name: 'scanner', systemPrompt: 'Scan the codebase.', tools: ['Read', 'Glob', 'Grep'] },
 *   { name: 'summarizer', systemPrompt: 'Write a summary.', tools: ['Write'] },
 * ])
 * ```
 */
export async function runPipeline(
  name: string,
  goal: string,
  steps: StepConfig[],
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const pipeline = new Pipeline(name)
  if (options) pipeline.options(options)
  for (const step of steps) {
    pipeline.step(step.name, step)
  }
  return pipeline.run(goal)
}
