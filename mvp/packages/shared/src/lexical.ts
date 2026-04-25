/**
 * 将纯文本转成 Lexical JSON（最小段落结构）。
 * 每段一个 paragraph，单个 text child。空输入返回一个空 paragraph。
 */
export function plainToLexical(text: string) {
  const paragraphs = (text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const children =
    paragraphs.length === 0
      ? [emptyParagraph()]
      : paragraphs.map((p) => paragraph(p))
  return {
    root: {
      type: 'root',
      format: '' as const,
      indent: 0,
      version: 1,
      direction: 'ltr' as const,
      children,
    },
  }
}

function paragraph(text: string) {
  return {
    type: 'paragraph',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    textFormat: 0,
    textStyle: '',
    children: [
      {
        type: 'text',
        text,
        format: 0,
        style: '',
        mode: 'normal' as const,
        detail: 0,
        version: 1,
      },
    ],
  }
}

function emptyParagraph() {
  return {
    type: 'paragraph',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    textFormat: 0,
    textStyle: '',
    children: [] as any[],
  }
}

/**
 * 从 lexical JSON 里抽纯文本（遍历所有 text 节点并按段落拼接）
 */
export function lexicalToPlain(node: any): string {
  if (!node) return ''
  const root = node.root || node
  const lines: string[] = []
  const walk = (n: any, buf: string[]) => {
    if (!n) return
    if (n.type === 'text' && typeof n.text === 'string') {
      buf.push(n.text)
      return
    }
    if (Array.isArray(n.children)) {
      const childBuf: string[] = []
      for (const c of n.children) walk(c, childBuf)
      if (n.type === 'paragraph' || n.type === 'heading') {
        lines.push(childBuf.join(''))
      } else {
        buf.push(childBuf.join(''))
      }
    }
  }
  walk(root, lines)
  return lines.filter(Boolean).join('\n\n')
}
