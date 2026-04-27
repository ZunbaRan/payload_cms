/**
 * @fileoverview Types for the Claude SDK-based orchestration layer.
 *
 * Re-exports core types from the original framework and adds
 * Claude-specific extensions.
 */

export type {
  AgentConfig,
  AgentRunResult,
  TeamConfig,
  TeamRunResult,
  Task,
  TaskStatus,
  TokenUsage,
  OrchestratorConfig,
  OrchestratorEvent,
  TraceEvent,
  MemoryStore,
} from './shared-types.js'

import type { AgentRunResult } from './shared-types.js'
import type { ZodSchema } from 'zod'

// ---------------------------------------------------------------------------
// Claude-specific extensions
// ---------------------------------------------------------------------------

/**
 * Claude Agent SDK agent configuration.
 * Extends the base AgentConfig with SDK-specific options.
 */
export interface ClaudeAgentConfig {
  /** Agent name */
  readonly name: string
  /** Model name (e.g. 'claude-sonnet-4-6') */
  readonly model?: string
  /** System prompt override */
  readonly systemPrompt?: string
  /** Tools to auto-approve (SDK built-in tool names) */
  readonly allowedTools?: readonly string[]
  /** Tools to deny */
  readonly disallowedTools?: readonly string[]
  /** Permission mode */
  readonly permissionMode?: 'default' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'auto'
  /** Skills to deny (exact name or prefix with '*') */
  readonly deniedSkills?: readonly string[]
  /** Disable MCP tools */
  readonly disableMcp?: boolean
  /** Max agentic turns */
  readonly maxTurns?: number
  /** Max budget in USD */
  readonly maxBudgetUsd?: number
  /** Timeout in milliseconds */
  readonly timeoutMs?: number
  /** Structured output schema */
  readonly outputSchema?: ZodSchema
  /** Load filesystem settings: 'project', 'user', 'local' */
  readonly settingSources?: Array<'project' | 'user' | 'local'>
  /** beforeRun hook */
  readonly beforeRun?: (context: { prompt: string; agent: ClaudeAgentConfig }) => Promise<{ prompt: string }> | { prompt: string }
  /** afterRun hook */
  readonly afterRun?: (result: AgentRunResult) => Promise<AgentRunResult> | AgentRunResult
}

/**
 * Team configuration for Claude SDK orchestration.
 */
export interface ClaudeTeamConfig {
  readonly name: string
  readonly agents: readonly ClaudeAgentConfig[]
  /** Enable shared memory between agents (via prompt injection) */
  readonly sharedMemory?: boolean
  /** Max parallel tasks */
  readonly maxConcurrency?: number
}

/**
 * Result from a single agent run via Claude SDK.
 */
export interface ClaudeAgentRunResult {
  readonly success: boolean
  readonly output: string
  readonly tokenUsage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  readonly toolCalls: Array<{
    toolName: string
    input: Record<string, unknown>
    output: string
    duration: number
  }>
  readonly sessionId?: string
  readonly costUsd?: number
  readonly structured?: unknown
  readonly loopDetected?: boolean
  readonly budgetExceeded?: boolean
}

// ---------------------------------------------------------------------------
// AutoResearch Types
// ---------------------------------------------------------------------------

/**
 * 单一检查项（客观是非题）
 */
export interface RubricObjective {
  /** 唯一 ID */
  readonly id: string
  /** 检查问题，例如："第一句话有没有具体数字？" */
  readonly question: string
  /** 权重（默认 1） */
  readonly weight?: number
  /** 是否反向计分（默认 false，即 "是" 得满分；若为 true，则 "否" 得满分） */
  readonly reverse?: boolean
}

/**
 * 主观感受评分
 */
export interface RubricSubjective {
  /** 检查问题，例如："作为读者，你有想继续读下去吗？" */
  readonly question: string
  /** 通过阈值（1-10 分） */
  readonly threshold: number
  /** 权重（默认 1） */
  readonly weight?: number
}

/**
 * 评分规则
 */
export interface Rubric {
  /** 客观是非题列表 */
  readonly objective: readonly RubricObjective[]
  /** 主观感受评分 */
  readonly subjective: RubricSubjective
}

/**
 * 单次迭代的打分结果
 */
export interface ScoreReport {
  /** 客观检查详情 */
  readonly objective: Array<{
    id: string
    passed: boolean
    weight: number
    score: number
  }>
  /** 主观打分 (1-10) */
  readonly subjectiveScore: number
  readonly subjectiveWeight: number
  /** 总分 (归一化 0-1) */
  readonly totalScore: number
  /** Scorer 的具体反馈（扣分原因 + 改进建议） */
  readonly feedback: string
}

/**
 * 迭代历史记录
 */
export interface IterationRecord {
  readonly round: number
  readonly content: string
  readonly scoreReport: ScoreReport
  readonly action: 'pass' | 'rewrite' | 'regenerate'
}

/**
 * AutoResearch 最终结果
 */
export interface AutoResearchResult {
  /** 最终内容 */
  readonly content: string
  /** 最终分数 */
  readonly score: ScoreReport
  /** 迭代次数 */
  readonly iterations: number
  /** 是否因为达到阈值而提前通过 */
  readonly passed: boolean
  /** 迭代历史 */
  readonly history: readonly IterationRecord[]
}

// ---------------------------------------------------------------------------
// AutoResearch Node Context Types
// ---------------------------------------------------------------------------

/** Context provided to the Generator node on every round. */
export interface GeneratorContext {
  readonly goal: string
  readonly history: readonly IterationRecord[]
  readonly round: number
  /** true when this round is a clean-slate regenerate (not round 1) */
  readonly isRegenerate: boolean
  readonly rubric: Rubric
}

/** Context provided to the Scorer node on every round. */
export interface ScorerContext {
  readonly content: string
  readonly goal: string
  readonly history: readonly IterationRecord[]
  readonly round: number
  readonly rubric: Rubric
}

/** Context provided to the Decider node on every round. */
export interface DeciderContext {
  readonly content: string
  readonly scoreReport: ScoreReport
  readonly goal: string
  readonly history: readonly IterationRecord[]
  readonly round: number
  readonly rubric: Rubric
  readonly passThreshold: number
  readonly maxRounds: number
}

/** Context provided to the Rewriter node on every round. */
export interface RewriterContext {
  readonly content: string
  readonly scoreReport: ScoreReport
  readonly goal: string
  readonly history: readonly IterationRecord[]
  readonly round: number
  readonly rubric: Rubric
}

/**
 * Generator node: produces content from the current pipeline state.
 * Can be a single agent, an agent team, a sub-pipeline, or any async fn.
 */
export type GeneratorNode = (ctx: GeneratorContext) => Promise<string>

/**
 * Scorer node: evaluates content and returns a ScoreReport.
 * Can use LLM (score/yesno) or pure logic.
 */
export type ScorerNode = (ctx: ScorerContext) => Promise<ScoreReport>

/**
 * Decider node: decides the next action (pass / rewrite / regenerate).
 * Often pure logic in yesno mode; LLM-based in score mode.
 */
export type DeciderNode = (ctx: DeciderContext) => Promise<{
  action: 'pass' | 'rewrite' | 'regenerate'
  reason: string
}>

/**
 * Rewriter node: revises content given the current pipeline state.
 * Can be a single agent, sub-pipeline, or any async fn.
 */
export type RewriterNode = (ctx: RewriterContext) => Promise<string>

// ---------------------------------------------------------------------------
// AutoResearch Options
// ---------------------------------------------------------------------------

/**
 * AutoResearch 配置
 */
export interface AutoResearchOptions {
  /** 目标 Prompt（可选；实际 goal 通过 AutoResearchPipeline.run(goal) 传入） */
  readonly goal?: string
  /** 评分规则 */
  readonly rubric: Rubric
  /** 最大迭代次数（默认 10） */
  readonly maxIterations?: number
  /** 通过阈值（0-1，默认 0.8） */
  readonly passThreshold?: number
  /** 模型（默认同 orchestrator） */
  readonly model?: string
  /** 额外配置 */
  readonly timeoutMs?: number
  readonly maxTurns?: number

  // ── 节点级注入（优先级最高）─────────────────────────────────────────────
  // 可以是单个 Agent、Agent Team、子管道、纯逻辑函数——任意 async (ctx) => T
  readonly generatorNode?: GeneratorNode
  readonly scorerNode?: ScorerNode
  readonly deciderNode?: DeciderNode
  readonly rewriterNode?: RewriterNode

  // ── Prompt 快捷方式（向后兼容；节点未注入时框架用这些构建默认 Agent）───
  readonly generatorPrompt?: string
  readonly scorerPrompt?: string
  readonly deciderPrompt?: string
  readonly rewriterPrompt?: string
}
