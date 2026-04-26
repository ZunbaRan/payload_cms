import type { Config, Plugin } from 'payload'
import { AiConfig } from './globals/AiConfig'
import { TokenUsage } from './collections/TokenUsage'
import { processNoteTask } from './jobs/tasks'

export interface AiPluginOptions {
  enabled?: boolean
}

export const aiPlugin =
  (options: AiPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      globals: [...(incomingConfig.globals || []), AiConfig],
      collections: [...(incomingConfig.collections || []), TokenUsage],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [...((incomingConfig.jobs as any)?.tasks || []), processNoteTask],
      },
    }
  }

export { AiConfig } from './globals/AiConfig'
export { TokenUsage } from './collections/TokenUsage'
export { processNoteTask } from './jobs/tasks'
