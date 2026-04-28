/**
 * 启动 seed：
 *   - 如果 ai-models 集合是空的，按 .env 配置自动建一条 LLM 和一条 Embedding 模型，
 *     让 dev 用户开箱即用。
 *
 * 涉及的环境变量（全部可选，缺省时使用合理 dev 默认值）：
 *
 *   # LLM
 *   LLM_PROVIDER=openai|openai-compatible|anthropic|zhipu|bytedance
 *   LLM_BASE_URL=...
 *   LLM_API_KEY=...
 *   LLM_MODEL=...
 *
 *   # Embedding
 *   EMBED_PROVIDER=local|openai|openai-compatible|...
 *   EMBED_BASE_URL=...
 *   EMBED_API_KEY=...
 *   EMBED_MODEL=...               # local 模式 → Xenova/all-MiniLM-L6-v2
 *
 * Dev 默认：
 *   LLM       → 不创建（无 API key 不能跑 generate；用户自己配）
 *   Embedding → provider=local, modelId=Xenova/all-MiniLM-L6-v2
 *
 * Prod：用户必须显式配 LLM_* 和 EMBED_*。
 */
export async function seedDefaultAiModels(payload: any): Promise<void> {
  try {
    const found = await payload.find({
      collection: 'ai-models',
      limit: 1,
      depth: 0,
    })
    if (found.totalDocs > 0) return
  } catch (e) {
    // 集合还没建好（首次启动）会进 catch；下面 create 会再重试一次
    payload.logger?.debug?.('seed ai-models skip find:', (e as Error).message)
  }

  const seedRows: Array<{
    name: string
    provider: string
    modelId: string
    baseUrl?: string
    apiKey: string
    modelType: 'text' | 'embedding' | 'image' | 'video'
    priority: number
  }> = []

  // === Embedding ===
  const embedProvider = process.env.EMBED_PROVIDER || 'local'
  const embedModelId =
    process.env.EMBED_MODEL ||
    (embedProvider === 'local' ? 'Xenova/all-MiniLM-L6-v2' : '')
  if (embedModelId) {
    seedRows.push({
      name: `${embedProvider}-embedding`,
      provider: embedProvider,
      modelId: embedModelId,
      baseUrl: process.env.EMBED_BASE_URL,
      apiKey: process.env.EMBED_API_KEY || (embedProvider === 'local' ? 'local' : ''),
      modelType: 'embedding',
      priority: 10,
    })
  }

  // === LLM ===
  const llmModelId = process.env.LLM_MODEL
  if (llmModelId) {
    seedRows.push({
      name: `${process.env.LLM_PROVIDER || 'openai'}-llm`,
      provider: process.env.LLM_PROVIDER || 'openai',
      modelId: llmModelId,
      baseUrl: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY || '',
      modelType: 'text',
      priority: 5,
    })
  }

  for (const row of seedRows) {
    try {
      await payload.create({
        collection: 'ai-models',
        data: row as never,
        overrideAccess: true,
      })
      payload.logger?.info?.(`✓ seeded ai-model: ${row.name} (${row.modelId})`)
    } catch (e) {
      payload.logger?.warn?.(
        `seed ai-model ${row.name} failed: ${(e as Error).message}`,
      )
    }
  }
}
