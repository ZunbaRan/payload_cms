import type { Config, Plugin } from 'payload'
import { Examples } from './collections/Examples'

export interface ExamplePluginOptions {
  enabled?: boolean
}

export const examplePlugin =
  (options: ExamplePluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig

    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Examples],
    }
  }

export { Examples } from './collections/Examples'
