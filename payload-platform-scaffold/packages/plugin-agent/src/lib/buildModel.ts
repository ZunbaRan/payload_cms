/**
 * 把 ai-models 记录转成 Vercel AI SDK 的 LanguageModel
 *
 * 全部统一走 @ai-sdk/openai-compatible：
 *   - openai / openai-compatible / zhipu / bytedance / deepseek 等 → OpenAI 兼容协议
 *   - anthropic → 走 @ai-sdk/anthropic（messages API 不兼容 OpenAI）
 *   - local → 不支持文本生成（只是 embedding）
 */
import type { LanguageModel } from 'ai'

interface AiModelConfig {
  provider: string
  modelId: string
  baseUrl?: string
  apiKey?: string
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
}

export async function buildLanguageModel(model: AiModelConfig): Promise<LanguageModel> {
  const { provider, modelId, baseUrl, apiKey } = model

  if (provider === 'local') {
    throw new Error('本地模型不支持作为 agent 的对话模型，请选 OpenAI / 智谱 / 火山等')
  }

  if (provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    const ant = createAnthropic({
      apiKey,
      baseURL: baseUrl || undefined,
    })
    return ant(modelId)
  }

  // 其余全部走 openai-compatible
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  const url = baseUrl || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai
  const client = createOpenAICompatible({
    name: provider,
    apiKey,
    baseURL: url,
  })
  return client.chatModel(modelId)
}
