/**
 * @fileoverview Pipeline V3 类型定义
 *
 * 架构：prepare → plan(OpenSpec) → code(Superpowers,无Ralph) → test(Ralph+BDD) → reflect(PM独立)
 * 外层循环最多 maxOuterLoops 次
 */

import type { OtelConfig } from '../core/agent/claude-agent.js'

// ---------------------------------------------------------------------------
// 顶层配置
// ---------------------------------------------------------------------------

export interface PipelineV3Options {
  /** 项目目录（必须是 git 仓库） */
  readonly projectDir: string
  /** 用户需求 */
  readonly requirement: string
  /** 模型（默认使用 DEFAULT_MODEL 环境变量） */
  readonly model?: string
  /** 写入 projectDir/CLAUDE.md 的项目级静态信息 */
  readonly claudeMd?: string
  /** Reflect 阶段重新规划的最大轮次（默认 3） */
  readonly maxOuterLoops?: number
  /** Tester Ralph Loop 最大迭代次数（默认 20） */
  readonly ralphMaxIterations?: number
  /** 自定义环境变量 */
  readonly env?: Record<string, string>
  /** 进度回调 */
  readonly onProgress?: (event: V3ProgressEvent) => void
  /** OpenTelemetry 配置 */
  readonly otel?: OtelConfig
}

// ---------------------------------------------------------------------------
// 进度事件
// ---------------------------------------------------------------------------

export type V3Phase =
  | 'prepare'
  | 'plan'
  | 'code'
  | 'test'
  | 'reflect'
  | 'memory'
  | 'complete'

export interface V3ProgressEvent {
  readonly phase: V3Phase
  readonly status: 'start' | 'progress' | 'complete' | 'error'
  readonly message: string
  readonly iteration?: number
  readonly data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// OpenSpec Artifacts（Planner 阶段输出）
// ---------------------------------------------------------------------------

export interface OpenSpecArtifacts {
  /** openspec change 目录名（e.g. "add-dark-mode"） */
  readonly changeName: string
  /** openspec/changes/<name>/ 的绝对路径 */
  readonly changeDir: string
  /** specs/ 目录绝对路径 */
  readonly specsDir: string
  /** tasks.md 绝对路径 */
  readonly tasksFile: string
  /** proposal.md 绝对路径 */
  readonly proposalFile: string
  /** design.md 绝对路径 */
  readonly designFile: string
}

// ---------------------------------------------------------------------------
// Plan（phasePlan 输出，包含 OpenSpec artifacts 引用）
// ---------------------------------------------------------------------------

export interface Plan {
  /** OpenSpec artifacts 路径引用 */
  readonly artifacts: OpenSpecArtifacts
  /** Planner Agent 原始输出 */
  readonly raw: string
}

// ---------------------------------------------------------------------------
// Ralph Loop 状态（仅 Tester 使用）
// ---------------------------------------------------------------------------

export interface RalphState {
  readonly prompt: string
  readonly iteration: number
  readonly maxIterations: number
  readonly completionPromise: string
}

export interface RalphRunResult {
  readonly output: string
  readonly completed: boolean
  readonly iterations: number
  readonly tokenUsage: { input: number; output: number }
  readonly costUsd: number
}

// ---------------------------------------------------------------------------
// Memory Agent
// ---------------------------------------------------------------------------

export interface MemoryAgentInput {
  /** 触发本次更新的 Agent 角色 */
  readonly agentRole: 'planner' | 'coder' | 'tester' | 'reflector'
  /** 上一个 Agent 的完整输出文本 */
  readonly agentOutput: string
  /** 本阶段产生的 git diff */
  readonly gitDiff: string
  /** 当前 MEMORY.md 内容 */
  readonly currentMemory: string
  /** 原始需求（不变） */
  readonly requirement: string
  /** 当前外层循环轮次 */
  readonly outerLoop: number
  /** 最大外层循环轮次 */
  readonly totalOuterLoops: number
}

// ---------------------------------------------------------------------------
// 最终结果
// ---------------------------------------------------------------------------

export interface PipelineV3Result {
  readonly success: boolean
  readonly outerLoops: number
  readonly reflectorOutput: string
  readonly log: string[]
  readonly tokenUsage: { input: number; output: number }
  readonly totalCostUsd: number
  readonly featureBranch: string
  readonly projectDir: string
}
