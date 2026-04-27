/**
 * @fileoverview 高层 API — runTeam 简便封装
 *
 * 用户只需提供：
 * 1. 目标（goal）
 * 2. Agent 定义（名称 + 角色描述 + 可选配置）
 *
 * 支持：
 * - 进度监控（onProgress）
 * - 实时取消（AbortController）
 * - 消息日志（onMessage）
 *
 * @example
 * ```typescript
 * import { runTeam } from './src-claude-sdk/run-team.js'
 *
 * const result = await runTeam({
 *   goal: '写一篇 TypeScript vs JavaScript 对比报告',
 *   agents: [
 *     { name: 'researcher', role: '技术研究员，负责收集和分析信息', maxTurns: 12 },
 *     { name: 'writer', role: '文档专家，负责整理为结构化报告', maxTurns: 8 },
 *   ],
 *   onProgress: (event) => console.log(event.type, event.agent),
 * })
 * ```
 */

import { ClaudeOrchestrator } from '../execution/orchestrator.js'
import type { ClaudeAgentConfig } from '../types.js'
import type {
  AgentRunResult,
  OrchestratorEvent,
  TraceEvent,
  TokenUsage,
} from '../shared-types.js'

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

/**
 * Agent 定义 — 用户只需提供名称和角色
 */
export interface AgentDef {
  /** Agent 名称，用于 Coordinator 分配任务 */
  readonly name: string
  /** Agent 角色描述，Coordinator 据此分配任务 */
  readonly role: string
  /** 最大交互轮次（默认 15） */
  readonly maxTurns?: number
  /** 使用的模型（默认 orchestrator 的 defaultModel） */
  readonly model?: string
  /** 禁止的 skill 列表 */
  readonly deniedSkills?: readonly string[]
  /** 是否禁用 MCP 工具（默认 false） */
  readonly disableMcp?: boolean
  /** 从文件系统加载 skills（如 ['project', 'user']） */
  readonly settingSources?: Array<'project' | 'user' | 'local'>
  /** 额外禁止的工具 */
  readonly disallowedTools?: readonly string[]
}

/**
 * runTeam 选项
 */
export interface RunTeamOptions {
  /** 进度回调 */
  onProgress?: (event: OrchestratorEvent) => void
  /** 每条 SDK 消息回调（用于日志记录） */
  onMessage?: (agentName: string, msg: any) => void
  /** Trace 回调 */
  onTrace?: (event: TraceEvent) => void | Promise<void>
  /** 用于取消运行的 AbortSignal */
  abortSignal?: AbortSignal
  /** 默认模型（默认 'claude-sonnet-4-6'） */
  defaultModel?: string
  /** 最大并行任务数（默认 2） */
  maxConcurrency?: number
  /** 最大 token 预算 */
  maxTokenBudget?: number
}

/**
 * runTeam 返回结果
 */
export interface RunTeamResult {
  /** 最终是否成功 */
  readonly success: boolean
  /** 各 agent 执行结果 */
  readonly agentResults: ReadonlyMap<string, AgentRunResult>
  /** 总 token 使用量 */
  readonly totalTokenUsage: TokenUsage
  /** Coordinator 最终合成输出（便捷访问） */
  readonly synthesis?: string
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 根据 AgentDef 生成 ClaudeAgentConfig 的 systemPrompt
 */
function buildSystemPrompt(def: AgentDef): string {
  const lines: string[] = []

  // 角色描述
  lines.push(def.role)
  lines.push('')

  // 共享内存提示
  lines.push('## 协作规则')
  lines.push('- 团队成员会通过共享内存传递工作成果')
  lines.push('- 请充分利用这些上下文信息来完成你的任务')
  lines.push('- 不要尝试从文件系统读取，直接使用 prompt 中的上下文')

  return lines.join('\n')
}

/**
 * 将 AgentDef 转换为 ClaudeAgentConfig
 */
function defToConfig(def: AgentDef, defaultModel?: string): ClaudeAgentConfig {
  return {
    name: def.name,
    model: def.model ?? defaultModel,
    systemPrompt: buildSystemPrompt(def),
    maxTurns: def.maxTurns ?? 50, // 成员默认 maxTurns 不低于 50
    deniedSkills: def.deniedSkills ? [...def.deniedSkills] : undefined,
    disableMcp: def.disableMcp,
    settingSources: def.settingSources ? [...def.settingSources] : undefined,
    disallowedTools: def.disallowedTools ? [...def.disallowedTools] : undefined,
  }
}

// ---------------------------------------------------------------------------
// runTeam — 高层封装
// ---------------------------------------------------------------------------

/**
 * 运行一个多 Agent 团队来完成目标。
 *
 * 这是框架最简便的入口。你只需提供目标和 Agent 定义，
 * 其余的（任务分解、分配、执行、合成）全部自动完成。
 *
 * @param goal - 用自然语言描述团队要完成的目标
 * @param agents - Agent 定义列表
 * @param options - 可选配置（进度回调、取消信号等）
 * @returns 团队执行结果
 *
 * @example
 * ```typescript
 * // 基础用法
 * const result = await runTeam(
 *   '研究 Rust vs Go 的对比',
 *   [
 *     { name: 'researcher', role: '技术研究员，负责收集和分析信息' },
 *     { name: 'writer', role: '文档专家，负责整理为报告' },
 *   ]
 * )
 *
 * console.log(result.synthesis)
 * ```
 *
 * @example
 * ```typescript
 * // 带进度监控和取消
 * const controller = new AbortController()
 *
 * // 5 分钟后取消
 * setTimeout(() => controller.abort(), 5 * 60 * 1000)
 *
 * const result = await runTeam(
 *   '深度研究 GEO 项目',
 *   [
 *     { name: 'researcher', role: '研究员', maxTurns: 12 },
 *     { name: 'analyst', role: '架构师', maxTurns: 10 },
 *     { name: 'writer', role: '文档专家', maxTurns: 8 },
 *   ],
 *   {
 *     onProgress: (e) => console.log(`${e.type}: ${e.agent}`),
 *     abortSignal: controller.signal,
 *   }
 * )
 * ```
 */
export async function runTeam(
  goal: string,
  agents: readonly AgentDef[],
  options: RunTeamOptions = {},
): Promise<RunTeamResult> {
  // 强制成员默认 maxTurns 不低于 50
  const resolvedAgents = agents.map(a => ({
    ...a,
    maxTurns: a.maxTurns ?? 50,
  }))

  if (resolvedAgents.length === 0) {
    throw new Error('runTeam: agents 列表不能为空')
  }

  if (!goal.trim()) {
    throw new Error('runTeam: goal 不能为空')
  }

  // 创建编排器
  const orchestrator = new ClaudeOrchestrator({
    defaultModel: options.defaultModel,
    maxConcurrency: options.maxConcurrency ?? 2,
    maxTokenBudget: options.maxTokenBudget,
    onProgress: options.onProgress,
    onTrace: options.onTrace,
  })

  // 构建团队配置
  const agentConfigs = resolvedAgents.map(def => defToConfig(def, options.defaultModel))

  const team = {
    name: `team-${Date.now()}`,
    agents: agentConfigs,
    sharedMemory: true,
    maxConcurrency: options.maxConcurrency ?? 2,
  }

  // 执行
  const result = await orchestrator.runTeam(team, goal, {
    abortSignal: options.abortSignal,
    onMessage: options.onMessage,
  })

  // 提取合成结果
  const synthesisResult = result.agentResults.get('coordinator:synthesis')
  const synthesis = synthesisResult
    ? (synthesisResult as AgentRunResult).output
    : undefined

  return {
    success: result.success,
    agentResults: result.agentResults,
    totalTokenUsage: result.totalTokenUsage,
    synthesis,
  }
}

// ---------------------------------------------------------------------------
// 便捷工厂 — 创建可取消的 runTeam
// ---------------------------------------------------------------------------

/**
 * 创建一个可取消的 runTeam 控制器。
 *
 * 适用于需要长时间运行、且用户可能中途取消的场景。
 *
 * @example
 * ```typescript
 * const task = createCancelableTeam(
 *   '深度研究某个主题',
 *   [{ name: 'researcher', role: '研究员' }],
 *   { onProgress: (e) => updateUI(e) }
 * )
 *
 * // 用户点击取消按钮
 * cancelButton.onclick = () => task.cancel()
 *
 * // 等待完成或取消
 * try {
 *   const result = await task.run()
 *   console.log(result.synthesis)
 * } catch (e) {
 *   if (e.name === 'AbortError') {
 *     console.log('任务已取消')
 *   }
 * }
 * ```
 */
export function createCancelableTeam(
  goal: string,
  agents: readonly AgentDef[],
  options: Omit<RunTeamOptions, 'abortSignal'> = {},
): {
  /** 执行任务 */
  run: () => Promise<RunTeamResult>
  /** 取消任务 */
  cancel: () => void
  /** 是否已取消 */
  readonly isCancelled: boolean
} {
  const controller = new AbortController()
  let cancelled = false

  return {
    run: () => {
      if (cancelled) {
        return Promise.reject(new DOMException('任务已取消', 'AbortError'))
      }
      return runTeam(goal, agents, { ...options, abortSignal: controller.signal })
    },
    cancel: () => {
      if (!cancelled) {
        cancelled = true
        controller.abort()
      }
    },
    get isCancelled() {
      return cancelled
    },
  }
}
