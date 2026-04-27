/**
 * @fileoverview Claude SDK-based orchestrator for multi-agent team execution.
 *
 * Uses Claude Agent SDK for agent execution while preserving the task queue,
 * dependency management, and approval gate from the original framework.
 *
 * @example
 * ```ts
 * import { ClaudeOrchestrator, ClaudeTeamConfig } from './src-claude-sdk/orchestrator.js'
 * import { ClaudeAgent } from './src/agent/claude-agent.js'
 *
 * const orchestrator = new ClaudeOrchestrator({
 *   defaultModel: 'claude-sonnet-4-6',
 *   maxConcurrency: 3,
 * })
 *
 * const team: ClaudeTeamConfig = {
 *   name: 'research-team',
 *   agents: [
 *     { name: 'researcher', model: 'claude-sonnet-4-6', systemPrompt: 'You research topics.' },
 *     { name: 'writer', model: 'claude-sonnet-4-6', systemPrompt: 'You write clearly.' },
 *   ],
 *   sharedMemory: true,
 * }
 *
 * const result = await orchestrator.runTeam(team, 'Write a guide on TypeScript generics.')
 * ```
 */

import type {
  AgentConfig,
  AgentRunResult,
  OrchestratorConfig,
  OrchestratorEvent,
  Task,
  TaskStatus,
  TeamRunResult,
  TokenUsage,
  TraceEvent,
} from '../shared-types.js'
import { TaskQueue } from './task-queue.js'
import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../agent/claude-agent.js'
import {
  ClaudeTeamConfig,
  ClaudeAgentConfig,
  ClaudeAgentRunResult,
} from '../types.js'
import {
  ZERO_USAGE,
  addUsage,
  createTask,
  executeWithRetry,
  generateRunId,
  parseTaskSpecs,
  resolveClaudeCodeExecutablePath,
} from './utils.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONCURRENCY = 5
const DEFAULT_MODEL = 'claude-sonnet-4-6'

// ---------------------------------------------------------------------------
// SharedMemory (simple in-memory implementation)
// ---------------------------------------------------------------------------

interface SharedMemoryEntry {
  agent: string
  key: string
  value: string
  timestamp: Date
}

class SharedMemory {
  private entries: SharedMemoryEntry[] = []

  async write(agent: string, key: string, value: string): Promise<void> {
    this.entries.push({ agent, key, value, timestamp: new Date() })
  }

  async read(agent: string, key: string): Promise<string | null> {
    const entry = this.entries.find(e => e.agent === agent && e.key === key)
    return entry?.value ?? null
  }

  async getSummary(): Promise<string> {
    if (this.entries.length === 0) return ''

    const byAgent = new Map<string, SharedMemoryEntry[]>()
    for (const entry of this.entries) {
      let group = byAgent.get(entry.agent)
      if (!group) {
        group = []
        byAgent.set(entry.agent, group)
      }
      group.push(entry)
    }

    const lines: string[] = ['## Shared Team Memory', '']
    for (const [agent, agentEntries] of byAgent) {
      lines.push(`### ${agent}`)
      for (const e of agentEntries) {
        const displayValue = e.value.length > 200
          ? `${e.value.slice(0, 197)}…`
          : e.value
        lines.push(`- ${e.key}: ${displayValue}`)
      }
      lines.push('')
    }

    return lines.join('\n').trimEnd()
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveTokenBudget(primary?: number, fallback?: number): number | undefined {
  if (primary === undefined) return fallback
  if (fallback === undefined) return primary
  return Math.min(primary, fallback)
}

/**
 * Build the prompt for a task, injecting shared memory context.
 */
async function buildTaskPrompt(
  task: Task,
  memory: SharedMemory,
  teamAgents: readonly ClaudeAgentConfig[],
): Promise<string> {
  const lines: string[] = [
    `# Task: ${task.title}`,
    '',
    '## Your Task',
    task.description,
  ]

  // Inject shared memory summary PROMINENTLY
  const summary = await memory.getSummary()
  if (summary) {
    lines.push(
      '',
      '## Results from Previous Tasks (IMPORTANT: Use this context)',
      'The following information has been gathered by your teammates. ',
      'You MUST use this context to complete your task. Do NOT try to read it from files.',
      '',
      summary,
    )
  }

  return lines.join('\n')
}

/**
 * Build the coordinator system prompt.
 */
function buildCoordinatorSystemPrompt(
  agentConfigs: readonly ClaudeAgentConfig[],
): string {
  const agentList = agentConfigs
    .map(a => `- ${a.name}: ${a.systemPrompt ?? 'General purpose'}`)
    .join('\n')

  return [
    'You are a Task Coordinator. Your role is to decompose a high-level goal',
    'into a structured list of tasks that can be executed by a team of agents.',
    '',
    '## Available Agents',
    agentList,
    '',
    '## Instructions',
    '1. Break the goal into discrete, independent tasks.',
    '2. Each task should have a clear title and description.',
    '3. Assign tasks to specific agents when possible.',
    '4. Specify dependencies between tasks using titles.',
    '5. Output ONLY a JSON array, nothing else.',
    '',
    '## Web Search / Research Special Rules',
    'If the goal involves web search or information gathering:',
    '1. You MUST assign at least one task to an Agent specializing in "metaso-search + markdown-proxy".',
    '2. In the description of such task, explicitly state: "Use metaso-search for initial retrieval to get url/title/summary, then use markdown-proxy to fetch full page content based on those urls."',
    '3. Ensure the description clearly guides the agent to use these specific tools.',
    '',
    '## Output Format',
    '```json',
    '[',
    '  {',
    '    "title": "Task title",',
    '    "description": "Detailed description of what to do",',
    '    "assignee": "agent-name (optional)",',
    '    "dependsOn": ["Task title 1", "Task title 2"] (optional)',
    '  }',
    ']',
    '```',
  ].join('\n')
}

/**
 * Build the decomposition prompt for the coordinator.
 */
function buildDecompositionPrompt(
  goal: string,
  agentConfigs: readonly ClaudeAgentConfig[],
): string {
  const agentList = agentConfigs
    .map(a => `- **${a.name}**: ${a.systemPrompt ?? 'General purpose'}`)
    .join('\n')

  return [
    'Decompose the following goal into tasks for the team.',
    '',
    `**Goal**: ${goal}`,
    '',
    `**Available Agents**:\n${agentList}`,
    '',
    'Output a JSON array of tasks. Each task must have:',
    '- "title": short task name',
    '- "description": what needs to be done',
    '- "assignee": optional agent name',
    '- "dependsOn": optional array of task titles this task depends on',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// RunContext
// ---------------------------------------------------------------------------

interface RunContext {
  readonly team: ClaudeTeamConfig
  readonly agentPool: Map<string, ClaudeAgent>
  readonly memory: SharedMemory
  readonly agentResults: Map<string, AgentRunResult>
  readonly config: OrchestratorConfig
  readonly runId?: string
  readonly abortSignal?: AbortSignal
  readonly onMessage?: (agentName: string, msg: any) => void
  cumulativeUsage: TokenUsage
  readonly maxTokenBudget?: number
  budgetExceededTriggered: boolean
  budgetExceededReason?: string
}

// ---------------------------------------------------------------------------
// executeQueue
// ---------------------------------------------------------------------------

/**
 * Execute all tasks in the queue using Claude SDK agents.
 * Works in rounds: find pending tasks → dispatch in parallel → repeat.
 */
async function executeQueue(
  queue: TaskQueue,
  ctx: RunContext,
): Promise<void> {
  const { agentPool, memory, config } = ctx

  // Relay queue skip events
  const unsubSkipped = config.onProgress
    ? queue.on('task:skipped', (task) => {
        config.onProgress!({
          type: 'task_skipped',
          task: task.id,
          data: task,
        } satisfies OrchestratorEvent)
      })
    : undefined

  while (true) {
    // Check cancellation
    if (ctx.abortSignal?.aborted) {
      for (const t of queue.getByStatus('pending')) {
        queue.update(t.id, { status: 'skipped' as TaskStatus })
      }
      break
    }

    // Auto-assign unassigned tasks round-robin
    autoAssignTasks(queue, ctx.team.agents)

    const pending = queue.getByStatus('pending')
    if (pending.length === 0) break

    const completedThisRound: Task[] = []

    // Dispatch in parallel (respecting maxConcurrency)
    const batches: Task[][] = []
    for (let i = 0; i < pending.length; i += (config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)) {
      batches.push(pending.slice(i, i + (config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)))
    }

    for (const batch of batches) {
      const dispatchPromises = batch.map(async (task): Promise<void> => {
        queue.update(task.id, { status: 'in_progress' as TaskStatus })

        const assignee = task.assignee
        if (!assignee) {
          const msg = `Task "${task.title}" has no assignee.`
          queue.fail(task.id, msg)
          config.onProgress?.({ type: 'error', task: task.id, data: msg } satisfies OrchestratorEvent)
          return
        }

        const agent = agentPool.get(assignee)
        if (!agent) {
          const msg = `Agent "${assignee}" not found in pool for task "${task.title}".`
          queue.fail(task.id, msg)
          config.onProgress?.({
            type: 'error', task: task.id, agent: assignee, data: msg,
          } satisfies OrchestratorEvent)
          return
        }

        config.onProgress?.({
          type: 'task_start', task: task.id, agent: assignee, data: task,
        } satisfies OrchestratorEvent)

        config.onProgress?.({
          type: 'agent_start', agent: assignee, task: task.id, data: task,
        } satisfies OrchestratorEvent)

        // Build prompt with shared memory context
        const prompt = await buildTaskPrompt(task, memory, ctx.team.agents)

        // Execute with retry
        const taskStartMs = config.onTrace ? Date.now() : 0
        let retryCount = 0

        const result = await executeWithRetry(
          () => agent.run(prompt),
          task,
          (retryData) => {
            retryCount++
            config.onProgress?.({
              type: 'task_retry', task: task.id, agent: assignee, data: retryData,
            } satisfies OrchestratorEvent)
          },
        )

        // Emit trace
        if (config.onTrace) {
          const taskEndMs = Date.now()
          config.onTrace({
            type: 'task',
            runId: ctx.runId ?? '',
            taskId: task.id,
            taskTitle: task.title,
            agent: assignee,
            success: result.success,
            retries: retryCount,
            startMs: taskStartMs,
            endMs: taskEndMs,
            durationMs: taskEndMs - taskStartMs,
          } as TraceEvent)
        }

        // Store result
        const resultKey = `${assignee}:${task.id}`
        ctx.agentResults.set(resultKey, result)
        ctx.cumulativeUsage = addUsage(ctx.cumulativeUsage, result.tokenUsage)

        const totalTokens = ctx.cumulativeUsage.input_tokens + ctx.cumulativeUsage.output_tokens
        if (
          !ctx.budgetExceededTriggered &&
          ctx.maxTokenBudget !== undefined &&
          totalTokens > ctx.maxTokenBudget
        ) {
          ctx.budgetExceededTriggered = true
          ctx.budgetExceededReason = `Token budget exceeded: ${totalTokens} > ${ctx.maxTokenBudget}`
          config.onProgress?.({
            type: 'budget_exceeded', agent: assignee, task: task.id,
            data: new Error(ctx.budgetExceededReason),
          } satisfies OrchestratorEvent)
        }

        if (result.success) {
          // Write to shared memory
          await memory.write(assignee, `task:${task.id}:result`, result.output)

          const completedTask = queue.complete(task.id, result.output)
          completedThisRound.push(completedTask)

          config.onProgress?.({
            type: 'task_complete', task: task.id, agent: assignee, data: result,
          } satisfies OrchestratorEvent)

          config.onProgress?.({
            type: 'agent_complete', agent: assignee, task: task.id, data: result,
          } satisfies OrchestratorEvent)
        } else {
          queue.fail(task.id, result.output)
          config.onProgress?.({
            type: 'error', task: task.id, agent: assignee, data: result,
          } satisfies OrchestratorEvent)
        }
      })

      await Promise.all(dispatchPromises)

      if (ctx.budgetExceededTriggered) {
        queue.skipRemaining(ctx.budgetExceededReason ?? 'Skipped: token budget exceeded.')
        break
      }
    }

    // Approval gate
    if (config.onApproval && completedThisRound.length > 0) {
      autoAssignTasks(queue, ctx.team.agents)
      const nextPending = queue.getByStatus('pending')

      if (nextPending.length > 0) {
        let approved: boolean
        try {
          approved = await config.onApproval(completedThisRound, nextPending)
        } catch (err) {
          const reason = `Skipped: approval callback error — ${err instanceof Error ? err.message : String(err)}`
          queue.skipRemaining(reason)
          break
        }
        if (!approved) {
          queue.skipRemaining('Skipped: approval rejected.')
          break
        }
      }
    }
  }

  unsubSkipped?.()
}

/**
 * Auto-assign unassigned tasks round-robin to team agents.
 */
function autoAssignTasks(queue: TaskQueue, agents: readonly ClaudeAgentConfig[]): void {
  const pending = queue.list().filter(t => t.status === 'pending' && !t.assignee)
  if (pending.length === 0) return

  // Round-robin assignment
  const agentNames = agents.map(a => a.name)
  let idx = 0
  for (const task of pending) {
    const assignee = agentNames[idx % agentNames.length]
    queue.update(task.id, { assignee })
    idx++
  }
}

// ---------------------------------------------------------------------------
// ClaudeOrchestrator
// ---------------------------------------------------------------------------

/**
 * Multi-agent orchestrator using Claude Agent SDK.
 *
 * Preserves the task queue, dependency management, approval gate, and
 * progress callbacks from the original OpenMultiAgent, while using
 * Claude SDK for agent execution.
 */
export class ClaudeOrchestrator {
  private readonly config: Required<
    Omit<OrchestratorConfig, 'onApproval' | 'onProgress' | 'onTrace' | 'defaultBaseURL' | 'defaultApiKey' | 'maxTokenBudget'>
  > & Pick<OrchestratorConfig, 'onApproval' | 'onProgress' | 'onTrace' | 'defaultBaseURL' | 'defaultApiKey' | 'maxTokenBudget'>

  private completedTaskCount = 0

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      defaultModel: config.defaultModel ?? DEFAULT_MODEL,
      defaultProvider: config.defaultProvider ?? 'anthropic',
      defaultBaseURL: config.defaultBaseURL,
      defaultApiKey: config.defaultApiKey,
      maxTokenBudget: config.maxTokenBudget,
      onApproval: config.onApproval,
      onProgress: config.onProgress,
      onTrace: config.onTrace,
    }
  }

  // -------------------------------------------------------------------------
  // runTeam: flagship method
  // -------------------------------------------------------------------------

  /**
   * Run a team on a high-level goal with full automatic orchestration.
   *
   * 1. Coordinator agent decomposes goal into tasks (JSON output).
   * 2. Tasks loaded into TaskQueue with dependency resolution.
   * 3. Unassigned tasks auto-assigned to team agents.
   * 4. Tasks executed in dependency order, parallel up to maxConcurrency.
   * 5. Results persisted to shared memory for subsequent agents.
   * 6. Final synthesis by coordinator.
   *
   * @param team - Team configuration with agent roster.
   * @param goal - High-level natural-language goal.
   */
  async runTeam(
    team: ClaudeTeamConfig,
    goal: string,
    options?: { 
      abortSignal?: AbortSignal
      onMessage?: (agentName: string, msg: any) => void
    },
  ): Promise<TeamRunResult> {
    const agentConfigs = team.agents

    // ------------------------------------------------------------------
    // Step 1: Coordinator decomposes goal into tasks
    // ------------------------------------------------------------------
    const coordinatorConfig: ClaudeAgentConfig = {
      name: 'coordinator',
      model: this.config.defaultModel,
      systemPrompt: buildCoordinatorSystemPrompt(agentConfigs),
      maxTurns: 50, // Coordinator 需要更多轮次进行复杂分解与综合
      deniedSkills: [],
      disableMcp: true,
      // 禁止使用 Claude Code 内置的团队/任务管理工具
      // 强制 coordinator 只输出 JSON
      disallowedTools: ['TeamCreate', 'TeamDelete', 'Agent', 'TaskOutput', 'TaskStop', 'Task', 'SendMessage'],
    }

    const decompositionPrompt = buildDecompositionPrompt(goal, agentConfigs)
    const runId = this.config.onTrace ? generateRunId() : undefined
    
    // 提前定义 onMessage 回调
    const onMessageCallback = options?.onMessage

    this.config.onProgress?.({
      type: 'agent_start',
      agent: 'coordinator',
      data: { goal, agentCount: agentConfigs.length },
    } satisfies OrchestratorEvent)

    const decompositionResult = await this.createClaudeAgent(
      coordinatorConfig,
      onMessageCallback ? (msg) => onMessageCallback('coordinator', msg) : undefined,
    ).run(decompositionPrompt)

    this.config.onProgress?.({
      type: 'agent_complete',
      agent: 'coordinator',
      data: decompositionResult,
    } satisfies OrchestratorEvent)

    if (!decompositionResult.success) {
      throw new Error(
        `Coordinator failed to decompose goal: ${decompositionResult.output}`,
      )
    }

    // ------------------------------------------------------------------
    // Step 2: Parse task specs and load into TaskQueue
    // ------------------------------------------------------------------
    const specs = parseTaskSpecs(decompositionResult.output)
    if (!specs) {
      throw new Error(
        `Coordinator output could not be parsed as task list.\nOutput:\n${decompositionResult.output}`,
      )
    }

    // Create tasks and load into queue
    const queue = new TaskQueue()
    const titleToId = new Map<string, string>()

    // First pass: create all tasks
    const tasks: Task[] = specs.map(spec => {
      const task = createTask({
        title: spec.title,
        description: spec.description,
        assignee: spec.assignee,
      })
      titleToId.set(spec.title, task.id)
      return task
    })

    // Second pass: resolve dependencies (title → ID)
    for (let i = 0; i < specs.length; i++) {
      const task = tasks[i]!
      const spec = specs[i]!
      if (spec.dependsOn?.length) {
        task.dependsOn = spec.dependsOn
          .map(title => titleToId.get(title))
          .filter((id): id is string => id !== undefined)
      }
      queue.add(task)
    }

    // ------------------------------------------------------------------
    // Step 3: Build agent pool
    // ------------------------------------------------------------------
    const agentPool = this.buildAgentPool(
      agentConfigs, 
      team.sharedMemory ?? true,
      options?.onMessage,
    )

    // ------------------------------------------------------------------
    // Step 4: Execute queue
    // ------------------------------------------------------------------
    const memory = new SharedMemory()
    const agentResults = new Map<string, AgentRunResult>()

    const runContext: RunContext = {
      team,
      agentPool,
      memory,
      agentResults,
      config: this.config,
      runId,
      abortSignal: options?.abortSignal,
      onMessage: options?.onMessage,
      cumulativeUsage: { ...ZERO_USAGE },
      maxTokenBudget: resolveTokenBudget(undefined, this.config.maxTokenBudget),
      budgetExceededTriggered: false,
    }

    await executeQueue(queue, runContext)

    // ------------------------------------------------------------------
    // Step 5: Coordinator synthesizes final answer
    // ------------------------------------------------------------------
    const summary = await memory.getSummary()
    const synthesisPrompt = [
      '## Goal',
      goal,
      '',
      '## Task Results',
      summary || '(No tasks were completed.)',
      '',
      'Synthesize a comprehensive final answer based on the task results above.',
    ].join('\n')

    this.config.onProgress?.({
      type: 'agent_start',
      agent: 'coordinator',
      data: { phase: 'synthesis' },
    } satisfies OrchestratorEvent)

    const synthesisResult = await this.createClaudeAgent(
      { name: 'coordinator', maxTurns: 5, deniedSkills: [], disableMcp: true },
      onMessageCallback ? (msg) => onMessageCallback('coordinator', msg) : undefined,
    ).run(synthesisPrompt)

    this.config.onProgress?.({
      type: 'agent_complete',
      agent: 'coordinator',
      data: synthesisResult,
    } satisfies OrchestratorEvent)

    agentResults.set('coordinator:synthesis', synthesisResult)
    runContext.cumulativeUsage = addUsage(runContext.cumulativeUsage, synthesisResult.tokenUsage)

    // ------------------------------------------------------------------
    // Build final result
    // ------------------------------------------------------------------
    const totalTokenUsage: TokenUsage = {
      input_tokens: runContext.cumulativeUsage.input_tokens,
      output_tokens: runContext.cumulativeUsage.output_tokens,
    }

    if (synthesisResult.success) {
      this.completedTaskCount++
    }

    return {
      success: synthesisResult.success,
      agentResults,
      totalTokenUsage: totalTokenUsage,
    }
  }

  // -------------------------------------------------------------------------
  // runAgent: single agent query
  // -------------------------------------------------------------------------

  /**
   * Run a single prompt with a Claude SDK agent.
   */
  async runAgent(
    config: ClaudeAgentConfig,
    prompt: string,
  ): Promise<AgentRunResult> {
    const effectiveConfig: ClaudeAgentConfig = {
      ...config,
      maxBudgetUsd: resolveTokenBudget(
        config.maxBudgetUsd,
        this.config.maxTokenBudget,
      ),
    }

    const agent = this.createClaudeAgent(effectiveConfig)

    this.config.onProgress?.({
      type: 'agent_start',
      agent: config.name,
      data: { prompt },
    } satisfies OrchestratorEvent)

    const result = await agent.run(prompt)

    if (result.success) {
      this.completedTaskCount++
    }

    this.config.onProgress?.({
      type: 'agent_complete',
      agent: config.name,
      data: result,
    } satisfies OrchestratorEvent)

    return result
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a pool of ClaudeAgent instances from team configuration.
   */
  private buildAgentPool(
    agentConfigs: readonly ClaudeAgentConfig[],
    enableSharedMemory: boolean,
    onMessage?: (agentName: string, msg: any) => void,
  ): Map<string, ClaudeAgent> {
    const pool = new Map<string, ClaudeAgent>()

    for (const agentConfig of agentConfigs) {
      const agent = this.createClaudeAgent(agentConfig, 
        onMessage ? (msg) => onMessage(agentConfig.name, msg) : undefined,
      )
      pool.set(agentConfig.name, agent)
    }

    return pool
  }

  /**
   * Create a ClaudeAgent instance from configuration.
   */
  private createClaudeAgent(
    config: ClaudeAgentConfig,
    onMessage?: (msg: any) => void,
  ): ClaudeAgent {
    const agentConfig: AgentConfig = {
      name: config.name,
      model: config.model ?? this.config.defaultModel,
      provider: this.config.defaultProvider,
      baseURL: config.name === 'coordinator'
        ? this.config.defaultBaseURL
        : undefined,
      apiKey: config.name === 'coordinator'
        ? this.config.defaultApiKey
        : undefined,
      systemPrompt: config.systemPrompt,
      tools: config.allowedTools,
      maxTurns: config.maxTurns,
      maxTokenBudget: config.maxBudgetUsd,
      timeoutMs: config.timeoutMs,
      outputSchema: config.outputSchema,
      beforeRun: config.beforeRun as any,
      afterRun: config.afterRun,
    }

    const sdkOptions: import('../agent/claude-agent.js').ClaudeAgentOptions = {
      model: config.model ?? this.config.defaultModel,
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools as string[] | undefined,
      disallowedTools: config.disallowedTools as string[] | undefined,
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      timeoutMs: config.timeoutMs,
      deniedSkills: config.deniedSkills ? [...config.deniedSkills] : undefined,
      disableMcp: config.disableMcp,
      settingSources: config.settingSources,
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: this.config.defaultBaseURL ?? process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_API_KEY: this.config.defaultApiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN,
      },
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(),
      onMessage,
    }

    return new ClaudeAgent(agentConfig, sdkOptions)
  }
}
