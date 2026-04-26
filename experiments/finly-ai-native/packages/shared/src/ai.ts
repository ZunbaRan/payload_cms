import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.AI_API_KEY
  const baseURL = process.env.AI_BASE_URL
  if (!apiKey) throw new Error('AI_API_KEY not set')
  _client = new Anthropic({ apiKey, baseURL })
  return _client
}

const DEFAULT_MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-20241022'

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

export interface AiCallConfig {
  /** 覆盖模型 */
  modelId?: string
  /** Prompt 模板（支持 {{变量}} 占位符） */
  promptTemplate?: string
  /** 最大输出 token */
  maxTokens?: number
}

export interface AiCallResult<T> {
  output: T
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/** 简单模板渲染：替换 {{varName}} 占位符 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

/**
 * 核心 AI 调用：返回文本 + token 用量 + 消息记录
 * （用量数据可写入 TokenUsage Collection）
 */
export async function callAI(
  prompt: string,
  maxTokens = 512,
  modelId?: string,
): Promise<AiCallResult<string>> {
  const model = modelId || DEFAULT_MODEL
  const resp = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = resp.content[0]?.type === 'text' ? resp.content[0].text : ''
  const inputTokens = resp.usage.input_tokens
  const outputTokens = resp.usage.output_tokens

  return {
    output: text,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: text },
    ],
  }
}

// ─── 业务函数 ──────────────────────────────────────────────────────────────────

export async function generateTags(
  title: string,
  content: string,
  config?: AiCallConfig,
): Promise<AiCallResult<string[]>> {
  const defaultPrompt =
    '你是一个标签提取助手。根据以下笔记，输出 3 到 6 个精炼的中文标签（每个 2-6 字），' +
    '用 JSON 数组格式返回，只输出 JSON，不要任何解释。\n\n' +
    '标题：{{title}}\n\n内容：\n{{content}}\n\n示例输出：["架构", "Payload", "插件机制"]'

  const prompt = renderTemplate(config?.promptTemplate || defaultPrompt, {
    title,
    content: content.slice(0, 1500),
  })

  const result = await callAI(prompt, config?.maxTokens ?? 200, config?.modelId)

  let tags: string[] = []
  try {
    const match = result.output.match(/\[[\s\S]*?\]/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) {
        tags = parsed.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
      }
    }
  } catch { /* ignore */ }

  return { ...result, output: tags }
}

export async function classifyImportance(
  title: string,
  content: string,
  config?: AiCallConfig,
): Promise<AiCallResult<{ important: boolean; reason: string }>> {
  const defaultPrompt =
    '判断这条笔记对用户是否"重要"（涉及关键决策/截止日/核心洞见/需要后续跟进则算重要）。' +
    '只输出 JSON：{"important": true/false, "reason": "一句话理由（20字内）"}。\n\n' +
    '标题：{{title}}\n内容：{{content}}'

  const prompt = renderTemplate(config?.promptTemplate || defaultPrompt, {
    title,
    content: content.slice(0, 800),
  })

  const result = await callAI(prompt, config?.maxTokens ?? 120, config?.modelId)

  let output = { important: false, reason: '' }
  try {
    const match = result.output.match(/\{[\s\S]*?\}/)
    if (match) {
      const obj = JSON.parse(match[0])
      output = {
        important: Boolean(obj.important),
        reason: String(obj.reason || '').slice(0, 60),
      }
    }
  } catch { /* ignore */ }

  return { ...result, output }
}

export async function summarizeDocument(
  text: string,
  config?: AiCallConfig,
): Promise<AiCallResult<{ summary: string; keywords: string[] }>> {
  const defaultPrompt =
    '总结以下文档，输出 JSON（不要其他内容）：' +
    '{"summary": "3-5句话中文摘要", "keywords": ["关键词1", "关键词2", ...最多5个]}\n\n' +
    '文档内容：\n{{content}}'

  const prompt = renderTemplate(config?.promptTemplate || defaultPrompt, {
    content: text.slice(0, 6000),
  })

  const result = await callAI(prompt, config?.maxTokens ?? 600, config?.modelId)

  let output = { summary: result.output.slice(0, 200), keywords: [] as string[] }
  try {
    const match = result.output.match(/\{[\s\S]*\}/)
    if (match) {
      const obj = JSON.parse(match[0])
      output = {
        summary: String(obj.summary || '').slice(0, 800),
        keywords: Array.isArray(obj.keywords)
          ? obj.keywords.map((k: unknown) => String(k)).slice(0, 5)
          : [],
      }
    }
  } catch { /* ignore */ }

  return { ...result, output }
}
