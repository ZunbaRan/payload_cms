import type { TaskConfig } from 'payload'
import { createAiClient, getVectorStore } from '@scaffold/shared'

/**
 * embedKnowledgeChunk
 * 把单个 chunk 的内容向量化，并写入到当前生效的 VectorStore
 * （json/chroma/pgvector 都走相同接口）。
 */
export const embedKnowledgeChunk: TaskConfig<'embedKnowledgeChunk'> = {
  slug: 'embedKnowledgeChunk',
  inputSchema: [
    { name: 'chunkId', type: 'text', required: true },
    { name: 'aiModelId', type: 'text', required: true },
    { name: 'indexRunId', type: 'text' },
  ],
  outputSchema: [{ name: 'dim', type: 'number' }],
  handler: async ({ input: rawInput, req }) => {
    const input = rawInput as {
      chunkId: string
      aiModelId: string
      indexRunId?: string
    }
    const payload = req.payload
    const chunk = (await payload.findByID({
      collection: 'knowledge-chunks',
      id: input.chunkId,
      depth: 0,
    })) as {
      id: string | number
      content: string
      knowledgeBase: unknown
      chunkIndex?: number
    } | null
    if (!chunk) throw new Error(`Chunk ${input.chunkId} not found`)

    const model = (await payload.findByID({
      collection: 'ai-models',
      id: input.aiModelId,
      depth: 0,
    })) as unknown as { provider: string; modelId: string; baseUrl?: string; apiKey: string } | null
    if (!model) throw new Error(`AI model ${input.aiModelId} not found`)

    const ai = createAiClient(model)
    const result = await ai.embed({ input: chunk.content })
    const vector = result.embeddings[0] || []

    const kbRef = chunk.knowledgeBase
    const knowledgeBaseId =
      typeof kbRef === 'object' && kbRef !== null
        ? (kbRef as { id: string | number }).id
        : (kbRef as string | number)

    const store = await getVectorStore({ payload })
    await store.upsert([
      {
        id: String(chunk.id),
        vector,
        payload: {
          knowledgeBaseId,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
        },
      },
    ])

    await payload.update({
      collection: 'knowledge-chunks',
      id: input.chunkId,
      data: { tokenCount: result.totalTokens } as never,
      depth: 0,
      overrideAccess: true,
    })

    // 更新 index run 进度
    if (input.indexRunId) {
      try {
        const run = (await payload.findByID({
          collection: 'kb-index-runs',
          id: input.indexRunId,
          depth: 0,
        })) as {
          id: string | number
          totalChunks?: number
          embeddedChunks?: number
          startedAt?: string
        } | null
        if (run) {
          const total = run.totalChunks || 0
          const done = (run.embeddedChunks || 0) + 1
          const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100
          const isLast = total > 0 && done >= total
          const finished = isLast ? new Date() : null
          const startTs = run.startedAt ? new Date(run.startedAt).getTime() : Date.now()
          await payload.update({
            collection: 'kb-index-runs',
            id: input.indexRunId,
            data: {
              embeddedChunks: done,
              progress,
              ...(isLast
                ? {
                    status: 'success',
                    phase: 'done',
                    finishedAt: finished!.toISOString(),
                    durationMs: finished!.getTime() - startTs,
                  }
                : {}),
            } as never,
            depth: 0,
            overrideAccess: true,
          })
          if (isLast) {
            await payload.update({
              collection: 'knowledge-bases',
              id: knowledgeBaseId,
              data: {
                syncStatus: 'synced',
                lastSyncedAt: finished!.toISOString(),
              } as never,
              depth: 0,
              overrideAccess: true,
              context: { skipChunk: true },
            })
          }
        }
      } catch (e) {
        payload.logger?.warn?.(`update index run failed: ${(e as Error).message}`)
      }
    }

    return { output: { dim: vector.length } }
  },
}
