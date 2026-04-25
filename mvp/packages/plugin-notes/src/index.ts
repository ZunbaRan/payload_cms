import type { Config, Plugin } from 'payload'
import { Notes } from './collections/Notes'

export interface NotesPluginOptions {
  enabled?: boolean
}

export const notesPlugin =
  (options: NotesPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Notes],
    }
  }

export { Notes }
