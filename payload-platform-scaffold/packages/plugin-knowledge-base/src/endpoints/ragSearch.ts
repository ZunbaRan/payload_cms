import type { Endpoint, PayloadRequest } from 'payload'
import { createAiClient, getVectorStore } from '@scaffold/shared'

/**
 * POST /api/knowledge-bases/search
 * 通过当前 VectorStore 查询（json/chroma/pgvector 自动切换）。
 */
export const ragSearchEndpoint: Endpoint = {
  path: '/search',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await readJsonBody(req)) as {
      query?: string
      knowledgeBaseId?: string
      topK?: number
      aiModelId?: string
    }

    if (!body.query || !body.aiModelId) {
      return Response.json(
        { error: 'query and aiModelId are required' },
        { status: 400 },
      )
    }
    const topK = Math.min(Math.max(body.topK ?? 5, 1), 20)

    const model = (await req.payload.findByID({
      collection: 'ai-models',
      id: body.aiModelId,
      depth: 0,
    })) as { provider: string; modelId: string; baseUrl?: string; apiKey: string } | null
    if (!model) {
      return Response.json({ error: 'aiModel not found' }, { status: 404 })
    }

    const ai = createAiClient(model)
    const embRes = await ai.embed({ input: body.query })
    const queryVec = embRes.embeddings[0] || []
    if (queryVec.length === 0) {
      return Response.json({ error: 'embedding failed' }, { status: 502 })
    }

    const store = await getVectorStore({ payload: req.payload })
    const hits = await store.query(queryVec, topK, {
      knowledgeBaseId: body.knowledgeBaseId,
    })

    return Response.json({
      query: body.query,
      backend: store.kind,
      results: hits,
    })
  },
}

async function readJsonBody(req: PayloadRequest): Promise<unknown> {
  if (req.json) return req.json()
  return {}
}
