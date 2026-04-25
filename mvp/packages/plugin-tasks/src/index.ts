import type { Config, Plugin } from 'payload'
import { Tasks } from './collections/Tasks'

export interface TasksPluginOptions {
  enabled?: boolean
}

export const tasksPlugin =
  (options: TasksPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Tasks],
    }
  }

export { Tasks }
