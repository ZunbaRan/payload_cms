import type { Config, Plugin } from 'payload'
import { AgentSkills } from './collections/AgentSkills'
import { AgentTasks } from './collections/AgentTasks'
import { AgentTaskRuns } from './collections/AgentTaskRuns'
import { processAgentTaskRun } from './jobs/processAgentTaskRun'
import { introspectCollectionsEndpoint } from './endpoints/introspectCollections'

export interface AgentPluginOptions {
  enabled?: boolean
  /**
   * 自动给所有业务集合的编辑页注入"绑定的 AI 任务面板"按钮组。
   * 默认 true。设为 false 可关闭，改用每个字段的 AiTaskFieldButton 显式声明。
   */
  autoInjectPanel?: boolean
}

const PANEL_COMPONENT = '@scaffold/plugin-agent/admin/BoundAgentTasksPanel#default'

// 不要给这些系统/审计/Agent 自身的集合注入按钮面板（避免循环 / 噪声）
const SKIP_INJECT = new Set([
  'agent-tasks',
  'agent-task-runs',
  'agent-skills',
  'users',
  'payload-preferences',
  'payload-migrations',
  'payload-jobs',
  'payload-locked-documents',
])

export const agentPlugin =
  (options: AgentPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig

    const autoInjectPanel = options.autoInjectPanel !== false

    const incomingCollections = incomingConfig.collections || []

    // 把 BoundAgentTasksPanel 注入到所有业务集合的 beforeDocumentControls
    const injectedCollections = autoInjectPanel
      ? incomingCollections.map((c) => {
          if (SKIP_INJECT.has(c.slug)) return c
          const existing = c.admin?.components?.edit?.beforeDocumentControls || []
          if (existing.includes(PANEL_COMPONENT)) return c
          return {
            ...c,
            admin: {
              ...(c.admin || {}),
              components: {
                ...(c.admin?.components || {}),
                edit: {
                  ...(c.admin?.components?.edit || {}),
                  beforeDocumentControls: [PANEL_COMPONENT, ...existing],
                },
              },
            },
          }
        })
      : incomingCollections

    return {
      ...incomingConfig,
      collections: [...injectedCollections, AgentSkills, AgentTasks, AgentTaskRuns],
      endpoints: [...(incomingConfig.endpoints || []), introspectCollectionsEndpoint],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [...(incomingConfig.jobs?.tasks || []), processAgentTaskRun],
      },
    }
  }

export { processAgentTaskRun }
export { AgentSkills, AgentTasks, AgentTaskRuns }
export { aiTaskButtonField } from './fields/aiTaskButtonField'
export type { AiTaskButtonFieldOptions } from './fields/aiTaskButtonField'

