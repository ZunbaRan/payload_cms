import type { Endpoint, PayloadRequest } from 'payload'
import { createAiClient } from '@scaffold/shared'

interface TestBody {
  id?: string
  provider?: string
  modelId?: string
  baseUrl?: string
  apiKey?: string
  modelType?: 'text' | 'embedding' | 'image' | 'video'
  temperature?: number
  maxTokens?: number
}

/**
 * POST /api/ai-models/test-connection
 * Body: 可以直接传当前表单值；也可以传 { id } 让后端从 DB 读
 * 行为：
 *   - text 模型：发 "你好"，看是否能拿到回复
 *   - embedding 模型：embed "你好"，看是否能拿到向量
 *   - image / video：暂不测试，直接报"暂不支持"
 */
export const testConnectionEndpoint: Endpoint = {
  path: '/test-connection',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = ((await (
      req as unknown as { json?: () => Promise<TestBody> }
    ).json?.()) || {}) as TestBody

    let model: TestBody = body
    if (body.id) {
      const found = (await req.payload.findByID({
        collection: 'ai-models',
        id: body.id,
        depth: 0,
      })) as unknown as TestBody
      if (!found) return Response.json({ error: 'Model not found' }, { status: 404 })
      model = found
      // 表单上 apiKey 没改的话用 DB 的；改了用表单值
      if (body.apiKey && body.apiKey.trim().length > 0) model.apiKey = body.apiKey
    }

    const provider = model.provider
    const modelId = model.modelId
    const modelType = model.modelType || 'text'

    if (!provider || !modelId) {
      return Response.json(
        { error: '缺少 provider 或 modelId，请先填写' },
        { status: 400 },
      )
    }

    if (modelType === 'image' || modelType === 'video') {
      return Response.json(
        {
          success: false,
          error: `${modelType === 'image' ? '图片' : '视频'}生成模型暂不支持自动测试，请手动校验`,
        },
        { status: 400 },
      )
    }

    const startedAt = Date.now()
    try {
      const ai = createAiClient({
        provider,
        modelId,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey || '',
        temperature: model.temperature,
        maxTokens: model.maxTokens,
      })

      if (modelType === 'embedding') {
        const out = await ai.embed({ input: '你好' })
        const dim = out.embeddings[0]?.length || 0
        return Response.json({
          success: true,
          modelType,
          message: `✓ 连接成功，embedding 维度 = ${dim}`,
          latencyMs: Date.now() - startedAt,
          sample: out.embeddings[0]?.slice(0, 4).map((n) => Number(n.toFixed(4))),
        })
      }

      const out = await ai.generate({
        systemPrompt: 'You are a helpful assistant. Reply briefly.',
        userPrompt: '你好',
      })
      const reply = (out.content || '').trim()
      return Response.json({
        success: true,
        modelType,
        message: '✓ 连接成功',
        latencyMs: Date.now() - startedAt,
        reply: reply.slice(0, 200),
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
        totalTokens: out.totalTokens,
      })
    } catch (e) {
      const err = e as Error
      return Response.json(
        {
          success: false,
          error: err.message || String(e),
          latencyMs: Date.now() - startedAt,
        },
        { status: 200 }, // 仍返回 200，前端通过 success=false 判断
      )
    }
  },
}
