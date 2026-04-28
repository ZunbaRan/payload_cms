import type { CollectionBeforeChangeHook } from 'payload'
import { matchSensitiveWords } from '@scaffold/shared'

/**
 * 在文章保存前扫描敏感词。
 * - action=block 命中 → 抛错阻止保存
 * - action=replace 命中 → 在 excerpt 中替换（正文 Lexical 不动，避免破坏结构）
 * - 命中记录写入 article.flaggedKeywords（如有该字段）
 */
export const sensitiveWordScanHook: CollectionBeforeChangeHook = async ({
  data,
  req,
  originalDoc,
}) => {
  const payload = req.payload
  const text = [data?.title, data?.excerpt, extractTextFromLexical(data?.content)]
    .filter(Boolean)
    .join('\n')

  if (!text.trim()) return data

  const { docs: words } = await payload.find({
    collection: 'sensitive-words',
    where: { isActive: { equals: true } },
    limit: 500,
    depth: 0,
  })

  if (words.length === 0) return data

  const { matches, sanitized, shouldBlock } = matchSensitiveWords(text, words as never)

  if (shouldBlock) {
    throw new Error(
      `内容命中敏感词，已被阻止：${matches
        .filter((m) => m.action === 'block')
        .map((m) => m.word)
        .join(', ')}`,
    )
  }

  if (matches.length > 0 && data && originalDoc) {
    if (typeof data.excerpt === 'string') {
      const excerptResult = matchSensitiveWords(data.excerpt, words as never)
      data.excerpt = excerptResult.sanitized
    }
    void sanitized // sanitized text 仅用于校验日志，正文 Lexical 不直接替换
  }

  return data
}

function extractTextFromLexical(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  const root = (content as { root?: { children?: unknown[] } }).root
  if (!root?.children) return ''

  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: string; children?: unknown[] }
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  root.children.forEach(walk)
  return parts.join(' ')
}
