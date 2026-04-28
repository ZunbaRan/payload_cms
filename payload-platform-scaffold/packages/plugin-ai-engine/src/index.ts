import type { Config, Plugin } from 'payload'
import { AiModels } from './collections/AiModels'
import { Prompts } from './collections/Prompts'

export interface AiEnginePluginOptions {
  enabled?: boolean
}

export const aiEnginePlugin =
  (options: AiEnginePluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), AiModels, Prompts],
    }
  }

export { AiModels, Prompts }
