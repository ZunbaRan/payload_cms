import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (client) return client
  const apiKey = process.env.AI_API_KEY
  const baseURL = process.env.AI_BASE_URL
  if (!apiKey) throw new Error('AI_API_KEY not set')
  client = new Anthropic({ apiKey, baseURL })
  return client
}

const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'

/**
 * 最简包装：发一条 user message，拿回一段文本
 */
export async function askAI(prompt: string, maxTokens = 512): Promise<string> {
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  const first = resp.content[0]
  if (first && first.type === 'text') return first.text
  return ''
}

/**
 * 基于笔记内容生成标签（3~6 个中文短标签）
 */
export async function generateTags(title: string, content: string): Promise<string[]> {
  const prompt = `你是一个标签提取助手。根据以下笔记，输出 3 到 6 个精炼的中文标签（每个 2-6 字），用 JSON 数组格式返回，只输出 JSON，不要任何解释。

标题：${title}

内容：
${content.slice(0, 1500)}

示例输出：["架构", "Payload", "插件机制"]`

  const text = await askAI(prompt, 200)
  try {
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) return []
    const tags = JSON.parse(match[0])
    return Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
      : []
  } catch {
    return []
  }
}

/**
 * 判断一条笔记是否"重要"（boolean + 简短理由）
 */
export async function classifyImportance(
  title: string,
  content: string,
): Promise<{ important: boolean; reason: string }> {
  const prompt = `判断这条笔记对用户是否"重要"（涉及关键决策/截止日/核心洞见/需要后续跟进则算重要）。只输出 JSON：{"important": true/false, "reason": "一句话理由（20字内）"}。

标题：${title}
内容：${content.slice(0, 800)}`
  const text = await askAI(prompt, 120)
  try {
    const match = text.match(/\{[\s\S]*?\}/)
    if (!match) return { important: false, reason: '' }
    const obj = JSON.parse(match[0])
    return {
      important: Boolean(obj.important),
      reason: String(obj.reason || '').slice(0, 60),
    }
  } catch {
    return { important: false, reason: '' }
  }
}

/**
 * 从 PDF 提取的文本生成摘要 + 关键词
 */
export async function summarizeDocument(
  text: string,
): Promise<{ summary: string; keywords: string[] }> {
  const prompt = `总结以下文档，输出 JSON（不要其他内容）：{"summary": "3-5句话中文摘要", "keywords": ["关键词1", "关键词2", ...最多5个]}

文档内容：
${text.slice(0, 6000)}`
  const out = await askAI(prompt, 600)
  try {
    const match = out.match(/\{[\s\S]*\}/)
    if (!match) return { summary: out.slice(0, 200), keywords: [] }
    const obj = JSON.parse(match[0])
    return {
      summary: String(obj.summary || '').slice(0, 800),
      keywords: Array.isArray(obj.keywords)
        ? obj.keywords.map((k: any) => String(k)).slice(0, 5)
        : [],
    }
  } catch {
    return { summary: out.slice(0, 200), keywords: [] }
  }
}
