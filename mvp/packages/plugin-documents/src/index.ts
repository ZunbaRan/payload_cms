import type { Config, Plugin } from 'payload'
import { Documents } from './collections/Documents'

export interface DocumentsPluginOptions {
  enabled?: boolean
}

export const documentsPlugin =
  (options: DocumentsPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Documents],
    }
  }

export { Documents }
