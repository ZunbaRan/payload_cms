import type { Config, Plugin } from 'payload'
import { ActivityLogs } from './collections/ActivityLogs'
import { SensitiveWords } from './collections/SensitiveWords'
import { SystemLogs } from './collections/SystemLogs'

export interface ModerationPluginOptions {
  enabled?: boolean
}

export const moderationPlugin =
  (options: ModerationPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        SensitiveWords,
        ActivityLogs,
        SystemLogs,
      ],
    }
  }

export { ActivityLogs, SensitiveWords, SystemLogs }
