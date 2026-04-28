export interface SensitiveWordLike {
  word: string
  severity?: 'low' | 'medium' | 'high'
  action?: 'flag' | 'replace' | 'block'
  replacement?: string | null
}

export interface SensitiveMatch {
  word: string
  severity: 'low' | 'medium' | 'high'
  action: 'flag' | 'replace' | 'block'
  count: number
}

/**
 * 在文本中匹配启用的敏感词。
 * 返回所有命中条目（带次数 + 最强动作）。
 */
export function matchSensitiveWords(
  text: string,
  words: SensitiveWordLike[],
): { matches: SensitiveMatch[]; sanitized: string; shouldBlock: boolean } {
  let sanitized = text
  let shouldBlock = false
  const matches: SensitiveMatch[] = []

  for (const w of words) {
    if (!w.word) continue
    const re = new RegExp(escapeRegExp(w.word), 'gi')
    const found = text.match(re)
    if (!found || found.length === 0) continue

    const action = w.action ?? 'flag'
    const severity = w.severity ?? 'medium'

    matches.push({
      word: w.word,
      severity,
      action,
      count: found.length,
    })

    if (action === 'block') shouldBlock = true
    if (action === 'replace') {
      const replacement = w.replacement ?? '*'.repeat(w.word.length)
      sanitized = sanitized.replace(re, replacement)
    }
  }

  return { matches, sanitized, shouldBlock }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
