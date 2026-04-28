/**
 * 极简版 HTML / 纯文本 → Lexical state 转换器。
 * 仅覆盖段落 + 行内文本，足以承载 GEOFlow 历史 Markdown / HTML 文章迁移。
 * 复杂 HTML（图片、表格、代码块）后续可接入 @lexical/html。
 */

interface LexicalTextNode {
  type: 'text'
  text: string
  format: number
  style: string
  mode: 'normal'
  detail: 0
  version: 1
}

interface LexicalParagraph {
  type: 'paragraph'
  version: 1
  direction: 'ltr' | null
  format: '' | 'left' | 'center' | 'right'
  indent: 0
  textFormat: 0
  textStyle: ''
  children: LexicalTextNode[]
}

interface LexicalRoot {
  root: {
    type: 'root'
    version: 1
    direction: 'ltr' | null
    format: ''
    indent: 0
    children: LexicalParagraph[]
  }
}

function paragraph(text: string): LexicalParagraph {
  return {
    type: 'paragraph',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    children: text
      ? [
          {
            type: 'text',
            text,
            format: 0,
            style: '',
            mode: 'normal',
            detail: 0,
            version: 1,
          },
        ]
      : [],
  }
}

export function plainTextToLexical(text: string): LexicalRoot {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(paragraph)

  return {
    root: {
      type: 'root',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      children: paragraphs.length ? paragraphs : [paragraph('')],
    },
  }
}

/**
 * 极简 HTML 解析：剥离标签后按段落处理。
 * 不依赖 DOM 解析器；适合服务端环境。
 */
export function htmlToLexical(html: string): LexicalRoot {
  const stripped = html
    .replace(/<\/(p|div|h[1-6]|li|br)\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
  return plainTextToLexical(stripped)
}
