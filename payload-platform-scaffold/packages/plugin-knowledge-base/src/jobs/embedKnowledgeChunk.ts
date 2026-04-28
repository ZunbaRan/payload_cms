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
  ],
  outputSchema: [{ name: 'dim', type: 'number' }],
  handler: async ({ input, req }) => {
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
    })) as { provider: string; modelId: string; baseUrl?: string; apiKey: string } | null
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

    return { output: { dim: vector.length } }
  },
}
