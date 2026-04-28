import type { Config, Plugin } from 'payload'
import { AgentSkills } from './collections/AgentSkills'
import { AgentTasks } from './collections/AgentTasks'
import { AgentTaskRuns } from './collections/AgentTaskRuns'
import { processAgentTaskRun } from './jobs/processAgentTaskRun'

export interface AgentPluginOptions {
  enabled?: boolean
}

export const agentPlugin =
  (options: AgentPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        AgentSkills,
        AgentTasks,
        AgentTaskRuns,
      ],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [...(incomingConfig.jobs?.tasks || []), processAgentTaskRun],
      },
    }
  }

export { processAgentTaskRun }
export { AgentSkills, AgentTasks, AgentTaskRuns }
