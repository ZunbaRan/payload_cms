import type { Config, Plugin } from 'payload'
import { KnowledgeBases } from './collections/KnowledgeBases'
import { KnowledgeChunks } from './collections/KnowledgeChunks'
import { KbUploads } from './collections/KbUploads'
import { KbIndexRuns } from './collections/KbIndexRuns'
import { embedKnowledgeChunk } from './jobs/embedKnowledgeChunk'
import { indexKnowledgeBase } from './jobs/indexKnowledgeBase'

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
        KbUploads,
        KbIndexRuns,
      ],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [
          ...(incomingConfig.jobs?.tasks || []),
          embedKnowledgeChunk,
          indexKnowledgeBase,
        ],
      },
    }
  }

export { embedKnowledgeChunk, indexKnowledgeBase }
export { KnowledgeBases, KnowledgeChunks, KbUploads, KbIndexRuns }
