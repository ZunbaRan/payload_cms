/**
 * @fileoverview Book Loader — 本地书籍 PDF 转 Markdown 并接入 Deep Research 流程。
 *
 * 处理用户提供的本地书籍文件（通常是 PDF）：
 * 1. 调用 pdf-to-md skill（DeepSeek OCR）将 PDF 转为高质量 Markdown
 * 2. 从 Markdown 标题行（#/##/###）提取 3 级目录树
 * 3. 按一级标题拆分 Markdown，保存到 materials/books/{bookName}/
 * 4. 生成结构化 index.md（含目录树 + 每节摘要）
 *
 * 返回 SavedMaterial[] 与 seed-crawler 一致，后续 index-generator 统一处理。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createClaudeAgent } from '../agent/claude-agent.js'
import { summarizeChunksInParallel } from './summarize-chunk-agent.js'
import type { SavedMaterial, SearchWorkspace, LocalBook } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeadingEntry {
  level: number     // 1, 2, or 3
  title: string
  lineIndex: number // 0-based line number in the full markdown
  summary: string   // first ~200 chars of content under this heading
}

interface ChapterChunk {
  index: number
  title: string
  content: string
  headings: HeadingEntry[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 处理一本本地书籍：PDF → Markdown → 3 级目录提取 → 按章拆分 → 保存。
 */
export async function loadLocalBook(
  book: LocalBook,
  workspace: SearchWorkspace,
  skillHubDir?: string,
  onProgress?: (msg: string) => void,
  summarizeModel?: string,
): Promise<SavedMaterial[]> {
  const filePath = book.filePath

  if (!fs.existsSync(filePath)) {
    onProgress?.(`[Book] File not found: ${filePath}`)
    return []
  }

  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.pdf' && ext !== '.md' && ext !== '.markdown') {
    onProgress?.(`[Book] Unsupported format: ${ext}. Only PDF and Markdown are supported.`)
    return []
  }

  const bookName = sanitizeBookName(book.title ?? path.basename(filePath, ext))
  const bookDir = path.join(workspace.booksDir, bookName)
  fs.mkdirSync(bookDir, { recursive: true })

  onProgress?.(`[Book] Processing: ${path.basename(filePath)} → ${bookDir}`)

  // ── Step 1: 获取 Markdown 内容（PDF 转换 or 直读）──
  let fullMd: string

  if (ext === '.pdf') {
    onProgress?.(`[Book] Converting PDF to Markdown via pdf-to-md agent...`)
    const outputDir = path.join(bookDir, '_conversion')
    const mdPath = await convertPdfToMarkdownWithAgent(filePath, outputDir, skillHubDir, onProgress)

    if (!mdPath || !fs.existsSync(mdPath)) {
      onProgress?.(`[Book] ❌ PDF conversion failed for: ${filePath}`)
      return []
    }
    fullMd = fs.readFileSync(mdPath, 'utf-8')
    onProgress?.(`[Book] Conversion complete: ${(fullMd.length / 1024).toFixed(0)}KB, ${fullMd.split('\n').length} lines`)
  } else {
    // .md / .markdown — 直接读取，跳过 PDF 转换
    onProgress?.(`[Book] Reading Markdown directly: ${path.basename(filePath)}`)
    fullMd = fs.readFileSync(filePath, 'utf-8')
    onProgress?.(`[Book] Loaded: ${(fullMd.length / 1024).toFixed(0)}KB, ${fullMd.split('\n').length} lines`)
  }

  // ── Step 2: 从 Markdown 标题提取 3 级目录树 ──
  onProgress?.(`[Book] Extracting 3-level heading structure...`)
  const headings = extractHeadingTree(fullMd)
  onProgress?.(`[Book] Found ${headings.length} headings (${headings.filter(h => h.level === 1).length} H1, ${headings.filter(h => h.level === 2).length} H2, ${headings.filter(h => h.level === 3).length} H3)`)

  // ── Step 3: 按一级标题拆分并保存 ──
  const results: SavedMaterial[] = []
  const lines = fullMd.split('\n')

  const h1Entries = headings.filter(h => h.level === 1)

  if (h1Entries.length >= 2) {
    // 有多个 H1 → 按 H1 拆分
    onProgress?.(`[Book] Splitting by ${h1Entries.length} H1 headings...`)
    const chunks = splitByHeadings(lines, h1Entries, headings)

    for (const ch of chunks) {
      const fileName = `${String(ch.index).padStart(2, '0')}-${sanitizeBookName(ch.title)}.md`
      const savePath = path.join(bookDir, fileName)

      const header = `> Source: ${filePath}\n> Book: ${bookName}\n> Chapter: ${ch.title}\n\n`
      fs.writeFileSync(savePath, header + ch.content, 'utf-8')

      results.push({
        relativePath: path.relative(workspace.materialsDir, savePath),
        absolutePath: savePath,
        source: 'book',
        dimensionId: ch.title,
        title: ch.title,
        headings: ch.headings.map(h => (h.level >= 3 ? '  ' : '') + h.title),
      })
    }
  } else {
    // H1 不足 → 尝试按 H2 拆分
    const h2Entries = headings.filter(h => h.level <= 2)
    if (h2Entries.length >= 3) {
      onProgress?.(`[Book] No enough H1s, splitting by ${h2Entries.length} H2 headings...`)
      const chunks = splitByHeadings(lines, h2Entries, headings)

      for (const ch of chunks) {
        const fileName = `${String(ch.index).padStart(2, '0')}-${sanitizeBookName(ch.title)}.md`
        const savePath = path.join(bookDir, fileName)

        const header = `> Source: ${filePath}\n> Book: ${bookName}\n> Chapter: ${ch.title}\n\n`
        fs.writeFileSync(savePath, header + ch.content, 'utf-8')

        results.push({
          relativePath: path.relative(workspace.materialsDir, savePath),
          absolutePath: savePath,
          source: 'book',
          dimensionId: ch.title,
          title: ch.title,
          headings: ch.headings.map(h => (h.level >= 3 ? '  ' : '') + h.title),
        })
      }
    } else {
      // 没有足够标题 → 按 10,000 字符分块 + 并行 AI 摘要
      const rawChunks = splitByChunks(fullMd)
      onProgress?.(`[Book] No heading structure, splitting into ${rawChunks.length} chunks (10k chars each)`)

      // 优先级：传入的 summarizeModel > FLASH_MODEL > DEFAULT_MODEL
      const model = summarizeModel ?? process.env.FLASH_MODEL ?? process.env.DEFAULT_MODEL ?? ''
      const summaries = await summarizeChunksInParallel(rawChunks, model, onProgress)

      for (let i = 0; i < rawChunks.length; i++) {
        const chunk = rawChunks[i]
        const { title: chunkTitle, summary: chunkSummary } = summaries[i]
        const fileName = `chunk-${String(chunk.index).padStart(3, '0')}.md`
        const savePath = path.join(bookDir, fileName)

        const frontmatter = [
          '---',
          `chunk: ${chunk.index} / ${rawChunks.length}`,
          `title: "${chunkTitle.replace(/"/g, "'")}"`,
          `summary: "${chunkSummary.replace(/"/g, "'")}"`,
          `source: "${filePath.replace(/"/g, "'")}"`,
          '---',
          '',
        ].join('\n')

        fs.writeFileSync(savePath, frontmatter + chunk.content, 'utf-8')

        results.push({
          relativePath: path.relative(workspace.materialsDir, savePath),
          absolutePath: savePath,
          source: 'book',
          dimensionId: bookName,
          title: `[Chunk ${chunk.index}/${rawChunks.length}] ${chunkTitle}`,
          summary: chunkSummary || undefined,
        })
      }
    }
  }

  // ── Step 4: 生成结构化 index.md（含目录树 + 摘要）──
  const indexContent = buildStructuredIndexMd(bookName, filePath, headings, results)
  fs.writeFileSync(path.join(bookDir, 'index.md'), indexContent, 'utf-8')

  onProgress?.(`[Book] Done: ${results.length} files saved for "${bookName}"`)
  return results
}

/**
 * 批量处理多本书（并行）。
 *
 * 每本 PDF 启动独立的 pdf-to-md Agent 并行转换，所有 Agent 共享
 * 同一个 pdf-agent-workspace（cwd），但写到各自独立的 outputDir。
 */
export async function loadLocalBooks(
  books: LocalBook[],
  workspace: SearchWorkspace,
  skillHubDir?: string,
  onProgress?: (msg: string) => void,
  summarizeModel?: string,
): Promise<SavedMaterial[]> {
  if (books.length === 0) return []

  onProgress?.(`[Books] Starting parallel PDF conversion for ${books.length} book(s)...`)

  const allResultsNested = await Promise.all(
    books.map(book => loadLocalBook(book, workspace, skillHubDir, onProgress, summarizeModel)),
  )

  const allResults = allResultsNested.flat()
  onProgress?.(`[Books] All done: ${allResults.length} files from ${books.length} books`)
  return allResults
}

// ---------------------------------------------------------------------------
// PDF → Markdown Conversion (ClaudeAgent + pdf-to-md skill)
// ---------------------------------------------------------------------------

/**
 * 用 ClaudeAgent 调用 pdf-to-md skill 将单个 PDF 转为 Markdown。
 *
 * 步骤：
 * 1. 创建临时工作区，符号链接 pdf-to-md skill
 * 2. 启动 Agent（bypassPermissions + settingSources:['project']）
 * 3. Agent 自主调用 /pdf-to-md 命令完成转换
 * 4. 返回 final_output.md 路径
 */
async function convertPdfToMarkdownWithAgent(
  pdfPath: string,
  outputDir: string,
  skillHubDir?: string,
  onProgress?: (msg: string) => void,
): Promise<string | undefined> {
  // 找到 pdf-to-md skill 目录
  const skillSrc = findPdfToMdSkillDir(skillHubDir)
  if (!skillSrc) {
    onProgress?.(`[Book] pdf-to-md skill not found — skipping agent conversion`)
    return undefined
  }

  // 创建独立的 agent workspace（每次转换独立，避免并发冲突）
  const agentWorkspace = path.join(os.tmpdir(), `pdf2md-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const agentSkillsDir = path.join(agentWorkspace, '.claude', 'skills')
  fs.mkdirSync(agentSkillsDir, { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const skillDest = path.join(agentSkillsDir, 'pdf-to-md')
  try {
    fs.symlinkSync(skillSrc, skillDest, 'dir')
  } catch {
    fs.mkdirSync(skillDest, { recursive: true })
    const skillMd = path.join(skillSrc, 'SKILL.md')
    if (fs.existsSync(skillMd)) fs.copyFileSync(skillMd, path.join(skillDest, 'SKILL.md'))
  }

  const bookName = path.basename(pdfPath)
  onProgress?.(`[Book] Agent starting for: ${bookName}`)

  try {
    const agent = createClaudeAgent(`pdf2md-${bookName}`, {
      systemPrompt: 'You are a PDF conversion assistant. Convert the given PDF to Markdown using the pdf-to-md skill.',
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      cwd: agentWorkspace,
      maxTurns: 15,
    })

    await agent.run(
      `Convert the PDF to Markdown using the pdf-to-md skill:\n\n` +
      `/pdf-to-md "${pdfPath}" --output "${outputDir}"\n\n` +
      `Report the result when done.`,
    )

    const outputFile = path.join(outputDir, 'final_output.md')
    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 100) {
      onProgress?.(`[Book] Agent done: ${bookName} → ${(fs.statSync(outputFile).size / 1024).toFixed(0)}KB`)
      return outputFile
    }

    onProgress?.(`[Book] Agent finished but no output found for: ${bookName}`)
    return undefined
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onProgress?.(`[Book] Agent error for ${bookName}: ${msg}`)
    // Agent 可能已部分完成
    const outputFile = path.join(outputDir, 'final_output.md')
    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 100) {
      return outputFile
    }
    return undefined
  } finally {
    // 清理临时 agent workspace
    try { fs.rmSync(agentWorkspace, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

/**
 * 查找 pdf-to-md skill 目录（非脚本路径，供 Agent 使用）。
 * 优先级：skillHubDir > 项目内 skill_hub > ~/.agents/skills
 */
function findPdfToMdSkillDir(skillHubDir?: string): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const candidates = [
    skillHubDir ? path.join(skillHubDir, 'pdf-to-md') : '',
    path.resolve(__dirname, '../../skill_hub', 'pdf-to-md'),
    path.join(home, '.agents', 'skills', 'pdf-to-md'),
    path.join(home, '.claude', 'skills', 'pdf-to-md'),
  ].filter(Boolean)

  return candidates.find(p => fs.existsSync(p))
}

// ---------------------------------------------------------------------------
// 3-Level Heading Extraction
// ---------------------------------------------------------------------------

/**
 * 从 Markdown 内容中提取 3 级标题树。
 * 识别 #, ##, ### 开头的行，提取标题文本和前 ~200 字摘要。
 */
/** 检测 Markdown 主要标题风格，供 extractHeadingTree 使用。 */
function detectHeadingStyle(fullMd: string): 'atx' | 'bold-line' | 'chinese-prefix' | 'numbered' | 'none' {
  const sampleLines = fullMd.split('\n').slice(0, 300)
  let atx = 0, bold = 0, chinese = 0, numbered = 0
  for (const line of sampleLines) {
    if (/^#{1,3}\s+\S/.test(line)) atx++
    else if (/^\*\*[^*\n]{3,60}\*\*\s*$/.test(line.trim())) bold++
    else if (/^(\u7b2c[\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+[\u7ae0\u8282\u7bc7\u90e8]|Chapter\s+\d+)/i.test(line)) chinese++
    else if (/^\d+(\.\d+)?\s+[\u4e00-\u9fffA-Z]/.test(line)) numbered++
  }
  const max = Math.max(atx, bold, chinese, numbered)
  if (max === 0) return 'none'
  if (atx >= max) return 'atx'
  if (bold >= max) return 'bold-line'
  if (chinese >= max) return 'chinese-prefix'
  return 'numbered'
}

function extractHeadingTree(fullMd: string): HeadingEntry[] {
  const lines = fullMd.split('\n')
  const headings: HeadingEntry[] = []
  const style = detectHeadingStyle(fullMd)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let level = 0
    let title = ''

    if (style === 'atx' || style === 'none') {
      const m = line.match(/^(#{1,3})\s+(.+)/)
      if (m) { level = m[1].length; title = m[2].trim() }
    } else if (style === 'bold-line') {
      // Bold-only line → treat as H2
      const m = line.trim().match(/^\*\*([^*\n]{3,60})\*\*\s*$/)
      if (m) { level = 2; title = m[1].trim() }
      // Also pick up ATX headings
      else {
        const m2 = line.match(/^(#{1,3})\s+(.+)/)
        if (m2) { level = m2[1].length; title = m2[2].trim() }
      }
    } else if (style === 'chinese-prefix') {
      const m = line.match(/^(\u7b2c[\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+[\u7ae0\u7bc7\u90e8])(.*)$/)
      if (m) { level = 1; title = (m[1] + m[2]).trim() }
      const m2 = line.match(/^(\u7b2c[\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\d]+\u8282)(.*)$/)
      if (m2) { level = 2; title = (m2[1] + m2[2]).trim() }
      // ATX fallback
      if (!title) {
        const m3 = line.match(/^(#{1,3})\s+(.+)/)
        if (m3) { level = m3[1].length; title = m3[2].trim() }
      }
    } else if (style === 'numbered') {
      const m = line.match(/^(\d+)(\.\d+)?\s+([\u4e00-\u9fffA-Za-z].{2,80})$/)
      if (m) {
        level = m[2] ? 2 : 1
        title = (m[1] + (m[2] ?? '') + ' ' + m[3]).trim()
      }
      // ATX fallback
      if (!title) {
        const m2 = line.match(/^(#{1,3})\s+(.+)/)
        if (m2) { level = m2[1].length; title = m2[2].trim() }
      }
    }

    if (!title || title.length < 2) continue

    // Extract summary from content below this heading
    const contentLines: string[] = []
    for (let j = i + 1; j < lines.length && contentLines.join(' ').length < 250; j++) {
      if (/^#{1,3}\s+/.test(lines[j])) break
      const t = lines[j].trim()
      if (t && !t.startsWith('>') && !t.startsWith('```') && !t.startsWith('---')) {
        contentLines.push(t)
      }
    }
    const summary = contentLines.join(' ').slice(0, 200).trim() + (contentLines.join(' ').length > 200 ? '...' : '')

    headings.push({ level, title, lineIndex: i, summary })
  }

  return headings
}

// ---------------------------------------------------------------------------
// Chapter Splitting by Headings
// ---------------------------------------------------------------------------

/**
 * 按一级标题（splitEntries）将全文拆分为多个 ChapterChunk。
 * allHeadings 用于附带每个 chunk 的子标题信息。
 */
function splitByHeadings(
  lines: string[],
  splitEntries: HeadingEntry[],
  allHeadings: HeadingEntry[],
): ChapterChunk[] {
  const chunks: ChapterChunk[] = []

  for (let i = 0; i < splitEntries.length; i++) {
    const entry = splitEntries[i]
    const startLine = entry.lineIndex
    const endLine = i + 1 < splitEntries.length
      ? splitEntries[i + 1].lineIndex
      : lines.length

    const content = lines.slice(startLine, endLine).join('\n').trim()

    // Collect sub-headings within this chunk
    const chunkHeadings = allHeadings.filter(
      h => h.lineIndex >= startLine && h.lineIndex < endLine,
    )

    chunks.push({
      index: i + 1,
      title: entry.title,
      content,
      headings: chunkHeadings,
    })
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Chunk Split + Parallel Summarizer
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 10_000   // characters
const CHUNK_OVERLAP = 200   // characters

/**
 * 当书籍缺乏标题结构时，按字符数滑动窗口拆分全文。
 * 在段落边界（双换行）处断开，保留 200 字重叠。
 */
function splitByChunks(fullMd: string): Array<{ index: number; content: string }> {
  const chunks: Array<{ index: number; content: string }> = []
  let pos = 0
  let idx = 1

  while (pos < fullMd.length) {
    const end = Math.min(pos + CHUNK_SIZE, fullMd.length)

    // 在段落边界断开（距 end 向前寻找双换行）
    let breakPos = end
    if (end < fullMd.length) {
      const lookback = fullMd.lastIndexOf('\n\n', end)
      if (lookback > pos + CHUNK_SIZE * 0.6) breakPos = lookback + 2
    }

    const content = fullMd.slice(pos, breakPos).trim()
    if (content.length > 50) chunks.push({ index: idx++, content })

    // 下一个窗口开始位置退回 CHUNK_OVERLAP
    pos = Math.max(breakPos - CHUNK_OVERLAP, pos + 1)
    if (breakPos >= fullMd.length) break
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeBookName(name: string, maxLen = 60): string {
  return name
    .replace(/[^\w\u4e00-\u9fff\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .toLowerCase() || 'book'
}

/**
 * 生成结构化 index.md：包含完整 3 级目录树 + 每节摘要 + 文件链接。
 *
 * 这是 Outliner 读取书籍信息的主要入口——目录树提供结构概览，
 * 摘要提供内容线索，文件链接用于后续 Stage B 精确定位素材。
 */
function buildStructuredIndexMd(
  bookName: string,
  filePath: string,
  headings: HeadingEntry[],
  materials: SavedMaterial[],
): string {
  const lines = [
    `# ${bookName}`,
    '',
    `> Source: ${filePath}`,
    `> Converted: ${new Date().toISOString()}`,
    `> Chapters: ${materials.length} files`,
    '',
  ]

  // ── 目录树（3 级）──
  lines.push('## 目录概览', '')

  for (const h of headings) {
    const indent = '  '.repeat(h.level - 1)
    const summaryPart = h.summary ? ` — ${h.summary}` : ''
    lines.push(`${indent}- ${h.title}${summaryPart}`)
  }
  lines.push('')

  // ── 章节文件列表 ──
  lines.push('## 章节文件', '')
  for (const m of materials) {
    const subHeadings = (m.headings ?? []).filter(h => !h.startsWith('  ')).slice(0, 5)
    const subPart = subHeadings.length > 0 ? ` (${subHeadings.join(', ')})` : ''
    lines.push(`- [${m.title}](${path.basename(m.absolutePath)})${subPart}`)
  }
  lines.push('')

  return lines.join('\n')
}
