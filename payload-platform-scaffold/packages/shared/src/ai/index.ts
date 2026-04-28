export interface AiModelLike {
  provider: string
  modelId: string
  baseUrl?: string | null
  apiKey: string
  temperature?: number | null
  maxTokens?: number | null
}

import { localEmbed } from './local'

export interface AiCompletionRequest {
  systemPrompt?: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface AiCompletionResult {
  content: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  raw?: unknown
}

export interface AiEmbeddingRequest {
  input: string | string[]
  signal?: AbortSignal
}

export interface AiEmbeddingResult {
  embeddings: number[][]
  totalTokens?: number
}

export interface AiClient {
  generate(req: AiCompletionRequest): Promise<AiCompletionResult>
  embed(req: AiEmbeddingRequest): Promise<AiEmbeddingResult>
}

export type AiClientFactory = (model: AiModelLike) => AiClient

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
}

function resolveBaseUrl(model: AiModelLike): string {
  if (model.baseUrl) return model.baseUrl.replace(/\/$/, '')
  return DEFAULT_BASE_URLS[model.provider] ?? DEFAULT_BASE_URLS.openai
}

/**
 * 通用 OpenAI-Compatible 客户端：覆盖 OpenAI / Zhipu / ByteDance / 任意自托管端点。
 * 当 provider === 'local' 时走 transformers.js 本地嵌入（零 API key，仅 embed 可用）。
 */
export function createAiClient(model: AiModelLike): AiClient {
  if (model.provider === 'local') {
    return createLocalClient(model)
  }
  const baseUrl = resolveBaseUrl(model)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${model.apiKey}`,
  }

  return {
    async generate(req) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model: model.modelId,
          temperature: req.temperature ?? model.temperature ?? 0.7,
          max_tokens: req.maxTokens ?? model.maxTokens ?? 4096,
          messages: [
            ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
            { role: 'user', content: req.userPrompt },
          ],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`AI provider ${model.provider} responded ${res.status}: ${text}`)
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      }
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
        raw: data,
      }
    },
    async embed(req) {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({ model: model.modelId, input: req.input }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Embedding provider ${model.provider} responded ${res.status}: ${text}`)
      }
      const data = (await res.json()) as {
        data?: { embedding: number[] }[]
        usage?: { total_tokens?: number }
      }
      return {
        embeddings: (data.data || []).map((row) => row.embedding),
        totalTokens: data.usage?.total_tokens,
      }
    },
  }
}

/**
 * 便捷封装。
 */
export async function generateText(
  model: AiModelLike,
  req: AiCompletionRequest,
): Promise<AiCompletionResult> {
  return createAiClient(model).generate(req)
}

export async function embed(
  model: AiModelLike,
  req: AiEmbeddingRequest,
): Promise<AiEmbeddingResult> {
  return createAiClient(model).embed(req)
}

// === local provider (transformers.js) ===

function createLocalClient(model: AiModelLike): AiClient {
  return {
    async generate() {
      throw new Error(
        "provider='local' 仅支持 embedding；LLM 生成请配置 LLM_BASE_URL/API_KEY/MODEL（OpenAI / DeepSeek / 通义 / ollama 等）",
      )
    },
    async embed(req) {
      const out = await localEmbed(model.modelId || 'Xenova/all-MiniLM-L6-v2', req.input)
      return out
    },
  }
}
