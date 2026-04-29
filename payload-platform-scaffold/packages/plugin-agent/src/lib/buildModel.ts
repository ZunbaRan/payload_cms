/**
 * 把 ai-models 记录转成 Vercel AI SDK 的 LanguageModel
 *
 * 全部统一走 @ai-sdk/openai-compatible：
 *   - openai / openai-compatible / zhipu / bytedance / deepseek 等 → OpenAI 兼容协议
 *   - anthropic → 走 @ai-sdk/anthropic（messages API 不兼容 OpenAI）
 *   - local → 不支持文本生成（只是 embedding）
 *
 * Thinking/Reasoning 兼容：
 *   - DeepSeek V3.1+ 默认开 thinking auto，多轮工具调用时若不回传 reasoning_content
 *     会报 "must be passed back to the API"。AI SDK 标准消息历史不包含该字段，因此
 *     **强制关闭 DeepSeek thinking** 是最稳的兼容方案（通过 `chat_template_kwargs.thinking=false`）。
 *   - GPT/Claude 的 thinking 由各自 provider 在 SDK 内部正确处理，无此问题。
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

/**
 * 当 baseUrl / provider / modelId 任一指向 DeepSeek 时返回 true。
 * 用于决定是否注入禁用 thinking 的 extra body。
 */
function isDeepSeekLike(model: AiModelConfig): boolean {
  const haystack = `${model.provider} ${model.modelId} ${model.baseUrl || ''}`.toLowerCase()
  return haystack.includes('deepseek')
}

/**
 * 包装全局 fetch：在 chat completions 请求体里追加 chat_template_kwargs.thinking=false。
 * 仅对包含 /chat/completions 的请求生效，不影响其它 path。
 */
function wrapFetchDisableThinking(): typeof fetch {
  const originalFetch = globalThis.fetch
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (
        init?.body &&
        typeof init.body === 'string' &&
        url.includes('/chat/completions')
      ) {
        const body = JSON.parse(init.body)
        body.chat_template_kwargs = {
          ...(body.chat_template_kwargs || {}),
          thinking: false,
        }
        return originalFetch(input, { ...init, body: JSON.stringify(body) })
      }
    } catch {
      // 解析失败就原样透传
    }
    return originalFetch(input, init)
  }
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
    fetch: isDeepSeekLike(model) ? wrapFetchDisableThinking() : undefined,
  })
  return client.chatModel(modelId)
}
