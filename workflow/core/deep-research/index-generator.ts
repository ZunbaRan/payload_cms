/**
 * @fileoverview Index Generator.
 *
 * 搜索阶段 3：扫描 materials/ 目录下所有已保存的 Markdown 文件，
 * 提取文件名 + 最多 3 级标题（H1/H2/H3），生成 INDEX.md 索引文件。
 *
 * INDEX.md 用于下一阶段（分析阶段）快速了解已收集的全部素材。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SavedMaterial, SearchWorkspace } from './types.js'
import { summarizeChunksInParallel } from './summarize-chunk-agent.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 扫描 workspace.materialsDir 下所有 .md 文件，生成两个索引文件。
 *
 * - **INDEX.md** (大纲视图)：每个文件一行标题—摘要，供 Outliner Agent 快速浏览。
 * - **index-reference.md** (路径映射表)：完整 Markdown 表，供后续阶段定位具体文件。
 *
 * 对于搜索/种子网页，可选传入 `summarizeModel` 进行 AI 并行摘要。
 * 对于有目录结构的书籍章节，不进行 AI 摘要，标题+子章节列表已足够。
 *
 * @returns `{ materials, referenceIndexPath }`
 */
export async function generateIndex(
  workspace: SearchWorkspace,
  opts: { summarizeModel?: string; onProgress?: (msg: string) => void } = {},
): Promise<{ materials: SavedMaterial[]; referenceIndexPath: string }> {
  const { summarizeModel, onProgress } = opts

  // 收集所有材料（可变，便于后续富化 summary）
  type MutableMaterial = { -readonly [K in keyof SavedMaterial]: SavedMaterial[K] }
  const materials: MutableMaterial[] = []

  collectFromDir(workspace.searchDir, workspace.materialsDir, 'search', materials as SavedMaterial[])
  collectFromDir(workspace.seedsDir, workspace.materialsDir, 'seed', materials as SavedMaterial[])
  collectFromDir(workspace.booksDir, workspace.materialsDir, 'book', materials as SavedMaterial[])

  // 对搜索/种子网页进行 AI 并行摘要
  // 仅当 caller 显式传入 summarizeModel 时才执行（中间刷新调用不传则跳过）
  if (summarizeModel) {
    const webPages = materials.filter(
      m => (m.source === 'search' || m.source === 'seed') && !m.summary,
    )

    if (webPages.length > 0) {
      onProgress?.(`[Index] AI-summarizing ${webPages.length} web pages...`)

      const chunks = webPages.map((m, i) => ({
        index: i + 1,
        content: fs.existsSync(m.absolutePath)
          ? fs.readFileSync(m.absolutePath, 'utf-8').slice(0, 4000)
          : m.summary ?? '',
      }))

      const summaries = await summarizeChunksInParallel(
        chunks,
        summarizeModel,
        onProgress,
      )

      webPages.forEach((m, i) => {
        const writable = m as { summary?: string; title?: string }
        if (summaries[i].summary) writable.summary = summaries[i].summary
        // 如果原标题很短或是文件名，用 AI 标题覆盖
        if (summaries[i].title && (!m.title || m.title === path.basename(m.relativePath, '.md'))) {
          writable.title = summaries[i].title
        }
      })
    }
  }

  // 生成 INDEX.md（大纲视图，供 Outliner 快速浏览）
  const indexContent = buildIndexMarkdown(materials, workspace)
  fs.writeFileSync(workspace.indexPath, indexContent, 'utf-8')

  // 生成 index-reference.md（完整文件路径映射表）
  const referenceContent = buildReferenceMarkdown(materials)
  fs.writeFileSync(workspace.referenceIndexPath, referenceContent, 'utf-8')

  return { materials: materials as SavedMaterial[], referenceIndexPath: workspace.referenceIndexPath }
}

// ---------------------------------------------------------------------------
// Directory Scanner
// ---------------------------------------------------------------------------

function collectFromDir(
  baseDir: string,
  materialsDir: string,
  source: 'search' | 'seed' | 'book',
  out: SavedMaterial[],
): void {
  if (!fs.existsSync(baseDir)) return

  walkDir(baseDir, (filePath) => {
    if (!filePath.endsWith('.md')) return

    // 跳过目录页 index.md（种子/书籍的目录，不是研究材料）
    if ((source === 'seed' || source === 'book') && path.basename(filePath) === 'index.md') return
    // 跳过书籍的 toc.md（目录提取文件）
    if (source === 'book' && path.basename(filePath) === 'toc.md') return

    const content = fs.readFileSync(filePath, 'utf-8')

    // 过滤失败/无效下载
    if (isFailedDownload(filePath, content)) return

    // 对于 chunk 文件（有 YAML frontmatter），优先从 frontmatter 提取 title / summary
    const fmTitle = extractFrontmatterField(content, 'title')
    const fmSummary = extractFrontmatterField(content, 'summary')

    const headings = extractHeadings(content)
    const title = fmTitle ?? headings[0] ?? path.basename(filePath, '.md')
    const sourceUrl = extractSourceUrl(content)
    const section = extractSection(content)
    const relativePath = path.relative(materialsDir, filePath)

    // 推断 dimensionId：
    // 1. 优先使用文件内嵌的 Section 元数据（种子页面 H2 分区）
    // 2. 回退到路径推断（search/foundations/01-xxx.md → foundations）
    const relFromBase = path.relative(baseDir, filePath)
    const pathBasedDimId = relFromBase.includes(path.sep)
      ? relFromBase.split(path.sep)[0]
      : undefined
    const dimensionId = section ?? pathBasedDimId

    out.push({
      relativePath,
      absolutePath: filePath,
      sourceUrl,
      source,
      dimensionId,
      title,
      headings,
      summary: fmSummary ?? extractSummary(content),
    })
  })
}

function walkDir(dir: string, handler: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 跳过 _conversion 临时目录（pdf-to-md 中间产物）
      if (entry.name === '_conversion') continue
      walkDir(full, handler)
    } else {
      handler(full)
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown Builder — INDEX.md (大纲视图)
// ---------------------------------------------------------------------------

function buildIndexMarkdown(materials: SavedMaterial[], workspace: SearchWorkspace): string {
  const lines: string[] = []

  lines.push('# Research Materials Index')
  lines.push('')
  lines.push(`> 自动生成于 ${new Date().toISOString()}`)
  lines.push(`> 共 ${materials.length} 个素材文件 | 完整文件映射见 [index-reference.md](./index-reference.md)`)
  lines.push('')

  const searchMats = materials.filter(m => m.source === 'search')
  const seedMats = materials.filter(m => m.source === 'seed')
  const bookMats = materials.filter(m => m.source === 'book')

  if (bookMats.length > 0) {
    lines.push(`## 📚 本地书籍 (${bookMats.length} 个文件)`)
    lines.push('')
    appendBookOutline(bookMats, lines)
  }

  if (searchMats.length > 0) {
    lines.push(`## 🔍 搜索素材 (${searchMats.length} 个文件)`)
    lines.push('')
    appendWebOutline(searchMats, lines)
  }

  if (seedMats.length > 0) {
    lines.push(`## 🌱 种子链接素材 (${seedMats.length} 个文件)`)
    lines.push('')
    appendWebOutline(seedMats, lines)
  }

  return lines.join('\n')
}

/**
 * 书籍材料大纲：
 * - 有子标题的章节 → 展示二/三级目录树（不需要 AI 总结）
 * - 无目录的 chunk → 展示 AI 标题：AI 摘要
 */
function appendBookOutline(materials: SavedMaterial[], lines: string[]): void {
  const groups = new Map<string, SavedMaterial[]>()
  for (const m of materials) {
    const key = m.dimensionId ?? '_ungrouped'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  for (const [dimId, mats] of groups) {
    if (dimId !== '_ungrouped') {
      lines.push(`### ${dimId}`)
      lines.push('')
    }
    for (const m of mats) {
      const isChunk = m.title?.startsWith('[Chunk ')
      if (isChunk) {
        // 无目录 chunk：标题：摘要（≤100字）
        const summaryPart = m.summary ? `：${m.summary.slice(0, 100)}` : ''
        lines.push(`- ${m.title}${summaryPart}`)
      } else {
        // 有目录章节：标题 + 子标题列表
        lines.push(`- **${m.title}**`)
        const subH = (m.headings ?? []).slice(1)
        if (subH.length > 0) {
          const h2s = subH.filter(h => !h.startsWith('  ')).slice(0, 6)
          if (h2s.length > 0) lines.push(`  - ${h2s.join(' | ')}`)
          const h3s = subH.filter(h => h.startsWith('  ')).map(h => h.trim()).slice(0, 6)
          if (h3s.length > 0) lines.push(`    - ${h3s.join(' | ')}`)
        }
      }
    }
    lines.push('')
  }
}

/**
 * 网页材料大纲（search / seed）：
 * 每条一行：标题：AI摘要（≤100字）
 */
function appendWebOutline(materials: SavedMaterial[], lines: string[]): void {
  const groups = new Map<string, SavedMaterial[]>()
  for (const m of materials) {
    const key = m.dimensionId ?? '_ungrouped'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  for (const [dimId, mats] of groups) {
    if (dimId !== '_ungrouped') {
      lines.push(`### ${dimId}`)
      lines.push('')
    }
    for (const m of mats) {
      const summaryPart = m.summary ? `：${m.summary.slice(0, 100)}` : ''
      lines.push(`- ${m.title}${summaryPart}`)
    }
    lines.push('')
  }
}

// ---------------------------------------------------------------------------
// Markdown Builder — index-reference.md (路径映射表)
// ---------------------------------------------------------------------------

function buildReferenceMarkdown(materials: SavedMaterial[]): string {
  const lines: string[] = []

  lines.push('# Index Reference — 完整文件映射表')
  lines.push('')
  lines.push(`> 自动生成于 ${new Date().toISOString()}`)
  lines.push('')
  lines.push('| 标题 | 来源 | 类型 | 文件路径 |')
  lines.push('|------|------|------|---------|')

  const typeLabel: Record<string, string> = {
    search: '搜索',
    seed: '种子链接',
    book: '书籍章节',
  }

  for (const m of materials) {
    const title = (m.title ?? path.basename(m.relativePath, '.md')).replace(/\|/g, '｜')
    const dim = (m.dimensionId ?? '—').replace(/\|/g, '｜')
    const type = typeLabel[m.source] ?? m.source
    const filePath = `\`${m.relativePath}\``
    lines.push(`| ${title} | ${dim} | ${type} | ${filePath} |`)
  }

  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Failed Download Detection
// ---------------------------------------------------------------------------

/**
 * 判断文件是否为下载失败的结果（404 页面、空文件、错误页面等）。
 */
function isFailedDownload(filePath: string, content: string): boolean {
  // 文件太小（<200 bytes）
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < 200) return true
  } catch {
    return true
  }

  // 检查首行/标题是否包含错误标志
  const firstLines = content.slice(0, 500).toLowerCase()
  if (/^#?\s*404\b/m.test(firstLines)) return true
  if (/page not found|not found|access denied|403 forbidden/i.test(firstLines)) return true
  if (/error\s+\d{3}\b/.test(firstLines)) return true

  // 全文太短（去除元数据行后<100字符）
  const bodyContent = content
    .split('\n')
    .filter(l => !l.startsWith('>') && l.trim().length > 0)
    .join('\n')
    .trim()
  if (bodyContent.length < 100) return true

  return false
}

// ---------------------------------------------------------------------------
// Heading Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * 从 YAML frontmatter 中提取指定字段值。
 * 支持带引号和不带引号的写法。
 */
function extractFrontmatterField(content: string, field: string): string | undefined {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return undefined
  const fieldMatch = fmMatch[1].match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, 'm'))
  return fieldMatch?.[1]?.trim() || undefined
}

function extractHeadings(content: string): string[] {
  const headings: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{1,3})\s+(.+)/)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()
      // 带层级前缀，方便 INDEX 区分展示
      headings.push(level === 3 ? `  ${text}` : text)
    }
  }
  return headings
}

function extractSourceUrl(content: string): string | undefined {
  const match = content.match(/>\s*Source:\s*(https?:\/\/\S+)/)
  return match?.[1]
}

/**
 * 从 Markdown 文件中提取 Section 元数据（由 seed-crawler 注入）。
 */
function extractSection(content: string): string | undefined {
  const match = content.match(/>\s*Section:\s*(.+)/)
  return match?.[1]?.trim()
}

/**
 * 从 Markdown 内容中提取摘要（第一段非标题、非空行、非引用的正文文本）。
 * 截断到 200 字符。
 */
function extractSummary(content: string, maxLen = 200): string | undefined {
  const lines = content.split('\n')
  let inFrontmatter = false

  for (const line of lines) {
    const trimmed = line.trim()

    // 跳过 YAML frontmatter
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue

    // 跳过空行、标题、引用块、图片、链接列表
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('>')) continue
    if (trimmed.startsWith('![')) continue
    if (trimmed.startsWith('- [')) continue
    if (trimmed.startsWith('* [')) continue
    if (/^(Title|URL Source|Published Time|Number of Pages|Markdown Content):/.test(trimmed)) continue

    // 找到正文段落
    const clean = trimmed.replace(/\*\*/g, '').replace(/\*/g, '')
    if (clean.length < 20) continue // 跳过太短的行

    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean
  }
  return undefined
}
