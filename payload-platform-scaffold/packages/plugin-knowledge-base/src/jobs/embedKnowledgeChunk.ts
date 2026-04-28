import type { TaskConfig } from 'payload'
import { createAiClient } from '@scaffold/shared'

/**
 * embedKnowledgeChunk
 * 把单个 chunk 写入 embedding 字段。
 * 上游：拆分 KnowledgeBase rawContent 后批量入队。
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
    const chunk = await payload.findByID({
      collection: 'knowledge-chunks',
      id: input.chunkId,
      depth: 0,
    })
    if (!chunk) throw new Error(`Chunk ${input.chunkId} not found`)

    const model = (await payload.findByID({
      collection: 'ai-models',
      id: input.aiModelId,
      depth: 0,
    })) as { provider: string; modelId: string; baseUrl?: string; apiKey: string } | null
    if (!model) throw new Error(`AI model ${input.aiModelId} not found`)

    const ai = createAiClient(model)
    const result = await ai.embed({ input: (chunk as { content: string }).content })
    const vector = result.embeddings[0] || []

    await payload.update({
      collection: 'knowledge-chunks',
      id: input.chunkId,
      data: { embedding: vector, tokenCount: result.totalTokens } as never,
      depth: 0,
      overrideAccess: true,
    })

    return { output: { dim: vector.length } }
  },
}
