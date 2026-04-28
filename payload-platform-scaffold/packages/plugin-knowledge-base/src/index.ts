import type { Config, Plugin } from 'payload'
import { KnowledgeBases } from './collections/KnowledgeBases'
import { KnowledgeChunks } from './collections/KnowledgeChunks'
import { embedKnowledgeChunk } from './jobs/embedKnowledgeChunk'

export interface KnowledgeBasePluginOptions {
  enabled?: boolean
}

export const knowledgeBasePlugin =
  (options: KnowledgeBasePluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        KnowledgeBases,
        KnowledgeChunks,
      ],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [...(incomingConfig.jobs?.tasks || []), embedKnowledgeChunk],
      },
    }
  }

export { embedKnowledgeChunk }
export { KnowledgeBases, KnowledgeChunks }
