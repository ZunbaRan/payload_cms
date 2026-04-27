/**
 * @fileoverview Shared types & enums for the coding-pipeline plugin.
 *
 * 只服务 V3 五段流程，phaseName 等枚举在此集中维护。
 */

export const PHASE_NAMES = ['prepare', 'plan', 'code', 'test', 'reflect'] as const
export type PhaseName = (typeof PHASE_NAMES)[number]

export const AGENT_ROLES = ['planner', 'coder', 'tester', 'reflector', 'memory'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting-review',
  'accepted',
  'rejected',
  'error',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const PHASE_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
] as const
export type PhaseStatus = (typeof PHASE_STATUSES)[number]

export const VERDICTS = ['accepted', 'revise'] as const
export type Verdict = (typeof VERDICTS)[number]

/**
 * Phase → 默认 agentRole 映射。
 * prepare 由 pipeline 自身处理，无 LLM 参与。
 */
export const PHASE_DEFAULT_ROLE: Record<PhaseName, AgentRole | null> = {
  prepare: null,
  plan: 'planner',
  code: 'coder',
  test: 'tester',
  reflect: 'reflector',
}

export interface CodingPipelinePluginOptions {
  /** 关闭整个 plugin（保留 schema 但不安装 jobs/hooks） */
  enabled?: boolean
  /**
   * `workflow/core` 的相对/绝对路径。运行时通过它动态加载 ClaudeAgent。
   * 默认尝试从 `process.env.WORKFLOW_CORE_PATH` 读取。
   */
  coreImportPath?: string
  /** 启动时若 collections 为空则写入 V3 默认配置（models/agentRoles/promptTemplates） */
  seedDefaults?: boolean
}
