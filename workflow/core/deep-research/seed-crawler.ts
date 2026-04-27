/**
 * @fileoverview Seed URL Crawler — Hybrid Mode.
 *
 * 处理用户提供的种子 URL（如 GitHub awesome-xxx 列表）：
 * 1. 抓取种子页面内容，保存为 Markdown，提取子链接
 * 2. 子链接分两路处理：
 *    - PDF 链接 → curl + markitdown 直接下载转换（零 Agent 成本）
 *    - 非 PDF 链接 → 单个协调 Agent + SubAgent 并行抓取（节省 session 开销）
 * 3. 所有抓取结果保存到 workspace/materials/seeds/
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions, AgentDefinition } from '../agent/claude-agent.js'
import type { SeedUrl, SavedMaterial, SearchWorkspace } from './types.js'
import { formatDocuments } from './doc-formatter.js'

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SEED_CRAWLER_SYSTEM_PROMPT = `You are a web content archiver. Follow these steps EXACTLY in order. Do NOT explore or try alternatives.

## Step 1: Save the page (ONE Bash command)
For GitHub URLs, use the raw README which is cleaner:
  \`curl -sL "https://r.jina.ai/https://raw.githubusercontent.com/{owner}/{repo}/main/README.md" > {SAVE_PATH}\`
For other URLs:
  \`curl -sL "https://r.jina.ai/{URL}" > {SAVE_PATH}\`

ONLY if the file is empty (0 bytes) after step 1, try the fallback:
  \`curl -sL "https://md.dhr.wtf/?url={URL}&enableDetailedResponse=false" > {SAVE_PATH}\`

NEVER use the Write tool for full page content. NEVER preview content with head/wc before saving.

## Step 2: Verify the file was saved
  \`wc -c {SAVE_PATH}\`
If size > 100 bytes, proceed to step 3. If 0 bytes, try the fallback above.

## Step 3: Clean up jina metadata header (optional, only if present)
  \`sed -i '' '1,/^Markdown Content:$/d' {SAVE_PATH}\`

## Step 4: Output JSON summary
Read the first 20 lines to get the title, then output EXACTLY:
  {"saved": true, "title": "Page Title", "links": []}

The links array is NOT needed — leave it empty. Links are extracted separately.

## RULES
- Do NOT try multiple fetch approaches. Do NOT check content before saving.
- Do NOT use the Skill tool. Just use Bash curl directly.
- Complete all 4 steps in ≤5 tool calls.
`

/**
 * SubAgent 定义：page-fetcher
 * 每个 SubAgent 调用负责抓取单个 URL 并保存为 Markdown。
 */
const PAGE_FETCHER_AGENT: AgentDefinition = {
  description: 'Fetches a single web page URL and saves its content as clean Markdown to a specified file path. Use this agent for each URL that needs to be fetched. You can call multiple page-fetcher agents in parallel.',
  prompt: `You are a web content archiver. Follow these steps EXACTLY:

1. Save the URL content with ONE Bash command:
   \`curl -sL "https://r.jina.ai/{URL}" > {SAVE_PATH}\`
   ONLY if file is 0 bytes, try: \`curl -sL "https://md.dhr.wtf/?url={URL}&enableDetailedResponse=false" > {SAVE_PATH}\`
2. Verify: \`wc -c {SAVE_PATH}\`
3. If saved, strip jina header: \`sed -i '' '1,/^Markdown Content:$/d' {SAVE_PATH}\`
4. Add source metadata: \`sed -i '' '1i\\
> Source: {URL}\\
' {SAVE_PATH}\`
5. Output: {"saved": true, "title": "Page Title"} or {"saved": false, "reason": "..."}

RULES: Do NOT use Write tool. Do NOT preview content. Do NOT use Skill tool. Complete in ≤4 tool calls.`,
}

/**
 * 协调 Agent 的系统提示 — 指导它使用 SubAgent 并行抓取多个 URL。
 */
function buildBatchCrawlerSystemPrompt(urlCount: number): string {
  return `You are a batch web page crawler coordinator.

## Your Task
You are given a list of ${urlCount} URLs with corresponding save paths.
You MUST use the "page-fetcher" SubAgent to fetch each URL in parallel.

## Execution Rules
- For EACH URL in the task list, call the "page-fetcher" agent with: the URL to fetch AND the file path to save to
- Launch ALL page-fetcher calls as quickly as possible — do NOT wait for one to finish before starting the next
- Do NOT fetch any pages yourself — delegate ALL fetching to page-fetcher SubAgents
- After all SubAgents complete, summarize the results

## Output Format
After all SubAgents finish, output a JSON array as your final message:
[
  {"url": "https://...", "path": "...", "saved": true, "title": "Page Title"},
  {"url": "https://...", "path": "...", "saved": false, "reason": "404 not found"}
]`
}

// ---------------------------------------------------------------------------
// Seed Crawler
// ---------------------------------------------------------------------------

/**
 * 抓取一个种子 URL 及其子链接（混合模式）。
 *
 * 策略：
 * - 种子主页：单独 Agent 抓取 + 提取链接
 * - PDF 子链接：curl + markitdown 直接转换
 * - 非 PDF 子链接：单个协调 Agent + SubAgent 并行抓取
 *
 * @returns 保存的材料文件列表
 */
export async function crawlSeedUrl(
  seed: SeedUrl,
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
  onProgress?: (msg: string) => void,
  maxSubLinkConcurrency?: number,
  maxSubLinks?: number,
): Promise<SavedMaterial[]> {
  const results: SavedMaterial[] = []
  const maxDepth = seed.maxDepth ?? 1
  const label = seed.label ?? new URL(seed.url).hostname

  // 为这个 seed 创建子目录
  const seedSubDir = path.join(workspace.seedsDir, sanitizeFileName(label))
  fs.mkdirSync(seedSubDir, { recursive: true })

  // ── Layer 0: 抓取种子页面本身 ──
  const mainFile = path.join(seedSubDir, 'index.md')
  onProgress?.(`Crawling seed: ${seed.url}`)

  const mainResult = await crawlSinglePage(
    seed.url,
    mainFile,
    SEED_CRAWLER_SYSTEM_PROMPT,
    workspace,
    sdkOptions,
  )

  if (mainResult.saved) {
    results.push({
      relativePath: path.relative(workspace.materialsDir, mainFile),
      absolutePath: mainFile,
      sourceUrl: seed.url,
      source: 'seed',
      title: mainResult.title ?? extractTitleFromFile(mainFile),
      headings: extractHeadings(mainFile),
    })
  }

  // ── Layer 1+: 混合模式处理子链接 ──
  // 从保存的 index.md 中直接提取链接（不依赖 agent 的 JSON 输出）
  const fileLinks = fs.existsSync(mainFile) ? extractLinksFromFile(mainFile, seed.url) : []
  const allLinks = fileLinks.length > 0 ? fileLinks : (mainResult.links ?? [])

  if (maxDepth >= 1 && allLinks.length > 0) {
    // 解析种子页面的 H2 分区结构，建立 URL→Section 映射
    const sectionMap = parseSeedPageSections(mainFile)
    onProgress?.(`  [Section] Parsed ${sectionMap.size} URL→section mappings from seed page`)

    const limit = maxSubLinks ?? 30
    const subLinks = allLinks.slice(0, limit)
    const validTasks = subLinks
      .map((subUrl, i) => ({
        subUrl,
        i,
        subFile: path.join(seedSubDir, `${String(i + 1).padStart(3, '0')}-${sanitizeFileName(urlToFileName(subUrl))}.md`),
      }))
      .filter(({ subUrl }) => isValidUrl(subUrl))

    // 分流：PDF vs 非 PDF
    const pdfTasks = validTasks.filter(t => isPdfUrl(t.subUrl))
    const webTasks = validTasks.filter(t => !isPdfUrl(t.subUrl))

    onProgress?.(`Found ${validTasks.length} sub-links: ${pdfTasks.length} PDFs (direct download), ${webTasks.length} web pages (SubAgent batch)`)

    // ── 通道 A: PDF 直接下载（并行，零 Agent 成本）──
    if (pdfTasks.length > 0 && isMarkitdownAvailable()) {
      const concurrency = maxSubLinkConcurrency ?? 5
      onProgress?.(`  [PDF] Downloading ${pdfTasks.length} PDFs with concurrency=${concurrency}...`)

      for (let batch = 0; batch < pdfTasks.length; batch += concurrency) {
        const chunk = pdfTasks.slice(batch, batch + concurrency)
        const settled = await Promise.allSettled(
          chunk.map(async ({ subUrl, i, subFile }) => {
            onProgress?.(`  [PDF ${i + 1}] Downloading: ${subUrl}`)
            const pdfResult = await downloadPdfAsMarkdown(subUrl, subFile)
            if (pdfResult.saved) {
              // 注入 Section 元数据
              const section = sectionMap.get(subUrl)
              if (section) insertSectionMetadata(subFile, section)
              return {
                relativePath: path.relative(workspace.materialsDir, subFile),
                absolutePath: subFile,
                sourceUrl: subUrl,
                source: 'seed' as const,
                dimensionId: section,
                title: pdfResult.title,
                headings: extractHeadings(subFile),
              }
            }
            return null
          }),
        )
        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value) results.push(r.value)
          else if (r.status === 'rejected') onProgress?.(`  [PDF] Failed: ${r.reason}`)
        }
      }
      onProgress?.(`  [PDF] Done: ${results.length - 1} PDFs saved`)
    }

    // ── 通道 B: 非 PDF → 单个协调 Agent + SubAgent 并行抓取 ──
    if (webTasks.length > 0) {
      onProgress?.(`  [SubAgent] Dispatching batch crawler for ${webTasks.length} web pages...`)

      const batchResults = await crawlWebPagesWithSubAgents(
        webTasks.map(t => ({ url: t.subUrl, savePath: t.subFile })),
        workspace,
        sdkOptions,
        onProgress,
      )

      for (const br of batchResults) {
        if (br.saved) {
          // 注入 Section 元数据
          const section = sectionMap.get(br.url)
          if (section) insertSectionMetadata(br.savePath, section)
          results.push({
            relativePath: path.relative(workspace.materialsDir, br.savePath),
            absolutePath: br.savePath,
            sourceUrl: br.url,
            source: 'seed',
            dimensionId: section,
            title: br.title,
            headings: extractHeadings(br.savePath),
          })
        }
      }
      onProgress?.(`  [SubAgent] Done: ${batchResults.filter(r => r.saved).length}/${webTasks.length} pages saved`)
    }
  }

  // ── 格式化阶段：用 Agent 对所有已保存文件进行格式化 ──
  const filesToFormat = results
    .filter(r => r.absolutePath && path.basename(r.absolutePath) !== 'index.md')
    .map(r => r.absolutePath)

  if (filesToFormat.length > 0) {
    onProgress?.(`[Formatter] Starting document formatting for ${filesToFormat.length} files...`)
    const formatResults = await formatDocuments(
      filesToFormat,
      sdkOptions,
      maxSubLinkConcurrency ?? 3,
      onProgress,
    )

    // 用格式化结果更新 results 中的 title 和 headings
    const formatMap = new Map(formatResults.map(r => [r.filePath, r]))
    for (const mat of results) {
      const fr = formatMap.get(mat.absolutePath)
      if (fr?.formatted) {
        // 使用类型断言更新只读字段
        const mutable = mat as { title?: string; headings?: readonly string[] }
        if (fr.title) mutable.title = fr.title
        mutable.headings = extractHeadings(mat.absolutePath)
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Single Page Crawler (Layer 0 only)
// ---------------------------------------------------------------------------

interface CrawlResult {
  saved: boolean
  title?: string
  links?: string[]
}

async function crawlSinglePage(
  url: string,
  savePath: string,
  systemPrompt: string,
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
): Promise<CrawlResult> {
  const agent = new ClaudeAgent(
    {
      name: `seed-crawler`,
      model: sdkOptions.model ?? '',
      systemPrompt,
      maxTurns: 8,
    },
    {
      ...sdkOptions,
      cwd: workspace.rootDir,
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      injectNetworkRule: true,
      maxTurns: 8,
      timeoutMs: sdkOptions.timeoutMs ?? 60_000,
    },
  )

  // Build a user prompt with GitHub raw URL hint if applicable
  let fetchHint = ''
  try {
    const u = new URL(url)
    if (u.hostname === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const owner = parts[0]
        const repo = parts[1]
        fetchHint = `\nHINT: This is a GitHub repo. Use the raw README URL for cleaner content:\n  curl -sL "https://r.jina.ai/https://raw.githubusercontent.com/${owner}/${repo}/main/README.md" > ${savePath}`
      }
    }
  } catch { /* ignore parse errors */ }

  const prompt = `Fetch the following URL and save its content as Markdown to: ${savePath}\n\nURL: ${url}${fetchHint}`

  try {
    const result = await agent.run(prompt)
    return parseAgentCrawlOutput(result.output)
  } catch {
    return { saved: false }
  }
}

// ---------------------------------------------------------------------------
// Batch Web Page Crawler (SubAgent pattern)
// ---------------------------------------------------------------------------

interface BatchCrawlResult {
  url: string
  savePath: string
  saved: boolean
  title?: string
}

/**
 * 使用单个协调 Agent + page-fetcher SubAgent 并行抓取多个非 PDF URL。
 *
 * 优势（vs 为每个 URL 启动独立 Agent）：
 * - 1 个 session 代替 N 个 session → 省 API 开销
 * - SDK 自动调度 SubAgent → Agent 工具调用并行
 * - SubAgent 继承 parent 的 skills（web-access/markdown-proxy）
 */
async function crawlWebPagesWithSubAgents(
  tasks: { url: string; savePath: string }[],
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
  onProgress?: (msg: string) => void,
): Promise<BatchCrawlResult[]> {
  // 构造任务列表给协调 Agent
  const taskList = tasks
    .map((t, i) => `${i + 1}. URL: ${t.url}\n   Save to: ${t.savePath}`)
    .join('\n')

  const coordinator = new ClaudeAgent(
    {
      name: 'seed-batch-crawler',
      model: sdkOptions.model ?? '',
      systemPrompt: buildBatchCrawlerSystemPrompt(tasks.length),
      maxTurns: Math.max(tasks.length * 3, 20), // 每个 SubAgent 调用至少需要 2-3 turns
    },
    {
      ...sdkOptions,
      cwd: workspace.rootDir,
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      injectNetworkRule: false, // coordinator 自身不抓页面，省 token
      maxTurns: Math.max(tasks.length * 3, 20),
      timeoutMs: sdkOptions.timeoutMs
        ? sdkOptions.timeoutMs * Math.ceil(tasks.length / 3)
        : 180_000,
      agents: {
        'page-fetcher': PAGE_FETCHER_AGENT,
      },
    },
  )

  const prompt = `Fetch the following ${tasks.length} web pages by dispatching page-fetcher SubAgents for each one.\nProcess them in parallel — call all page-fetcher agents without waiting.\n\n${taskList}`

  try {
    const result = await coordinator.run(prompt)

    // 日志
    const agentCalls = result.toolCalls.filter(tc => tc.toolName === 'Agent')
    onProgress?.(`  [SubAgent] Coordinator finished: ${agentCalls.length} Agent tool calls, ${result.toolCalls.length} total tool calls`)
    onProgress?.(`  [SubAgent] Tokens: in=${result.tokenUsage.input_tokens} out=${result.tokenUsage.output_tokens}`)

    // 解析结果：优先从输出 JSON 提取，回退到检查文件存在性
    return parseBatchResults(result.output, tasks)
  } catch (err) {
    onProgress?.(`  [SubAgent] Coordinator failed: ${err instanceof Error ? err.message : err}`)
    // 回退：检查哪些文件已被 SubAgent 成功保存
    return tasks.map(t => ({
      url: t.url,
      savePath: t.savePath,
      saved: fs.existsSync(t.savePath) && fs.statSync(t.savePath).size > 100,
      title: fs.existsSync(t.savePath) ? extractTitleFromFile(t.savePath) : undefined,
    }))
  }
}

/**
 * 解析协调 Agent 的批量结果输出。
 */
function parseBatchResults(
  output: string,
  tasks: { url: string; savePath: string }[],
): BatchCrawlResult[] {
  // 尝试从输出中提取 JSON 数组
  const jsonMatch = output.match(/\[[\s\S]*?\]/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        url?: string; path?: string; saved?: boolean; title?: string
      }>
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 用 JSON 结果和文件检查双重确认
        return tasks.map(t => {
          const match = parsed.find(p => p.url === t.url || p.path === t.savePath)
          const fileExists = fs.existsSync(t.savePath) && fs.statSync(t.savePath).size > 100
          return {
            url: t.url,
            savePath: t.savePath,
            saved: fileExists || Boolean(match?.saved),
            title: match?.title ?? (fileExists ? extractTitleFromFile(t.savePath) : undefined),
          }
        })
      }
    } catch { /* fall through */ }
  }

  // 回退：直接检查文件
  return tasks.map(t => ({
    url: t.url,
    savePath: t.savePath,
    saved: fs.existsSync(t.savePath) && fs.statSync(t.savePath).size > 100,
    title: fs.existsSync(t.savePath) ? extractTitleFromFile(t.savePath) : undefined,
  }))
}

/**
 * 从已保存的 Markdown 文件中提取标题。
 */
function extractTitleFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').slice(0, 500)
    const m = content.match(/^#\s+(.+)/m)
    return m?.[1]?.trim()
  } catch {
    return undefined
  }
}

/**
 * 从已保存的 Markdown 文件中提取所有 HTTP(S) 链接。
 * 用于从 index.md 中直接提取子链接（不依赖 agent 的 JSON 输出）。
 *
 * 过滤规则：
 * - 只保留 http/https 链接
 * - 排除 GitHub badge、shield.io 等装饰性链接
 * - 排除图片链接（jpg/png/gif/svg）
 * - 排除种子页面自身域名的非内容链接
 */
function extractLinksFromFile(filePath: string, seedUrl?: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const seen = new Set<string>()
    const links: string[] = []

    // Normalize seed URL for self-reference detection
    const seedNorm = seedUrl ? seedUrl.replace(/#.*$/, '').replace(/\/+$/, '') : ''

    // Skip header/badge area: start from first ## heading
    let contentStartLine = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        contentStartLine = i
        break
      }
    }
    const contentArea = lines.slice(contentStartLine).join('\n')

    // 匹配 markdown 链接 [text](url)
    const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
    let match
    while ((match = linkRegex.exec(contentArea)) !== null) {
      const url = match[2].trim()
      const urlNorm = url.replace(/#.*$/, '').replace(/\/+$/, '')
      if (seedNorm && urlNorm === seedNorm) continue
      if (!seen.has(url) && isContentLink(url)) {
        seen.add(url)
        links.push(url)
      }
    }

    // 也匹配裸 URL（在 "- " 列表项中）
    const bareUrlRegex = /^-\s+(https?:\/\/\S+)/gm
    while ((match = bareUrlRegex.exec(contentArea)) !== null) {
      const url = match[1].trim()
      const urlNorm = url.replace(/#.*$/, '').replace(/\/+$/, '')
      if (seedNorm && urlNorm === seedNorm) continue
      if (!seen.has(url) && isContentLink(url)) {
        seen.add(url)
        links.push(url)
      }
    }

    return links
  } catch {
    return []
  }
}

/**
 * 判断 URL 是否为内容链接（排除装饰性/非内容链接）。
 */
function isContentLink(url: string): boolean {
  // 排除图片/badge
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp)(\?|$)/i.test(url)) return false
  if (/shields\.io|badge|img\.shields/i.test(url)) return false
  // 排除 GitHub 代理图片 (camo)
  if (/camo\.githubusercontent\.com/i.test(url)) return false
  // 排除社交/工具链接
  if (/^https?:\/\/(twitter\.com|x\.com|linkedin\.com|facebook\.com|discord\.(gg|com))\//i.test(url)) return false
  // 排除 GitHub 内部功能链接（但保留 repo/issues/discussions）
  if (/github\.com\/[^/]+\/[^/]+\/(stargazers|network|watchers|graphs|settings)\b/.test(url)) return false
  return true
}

// ---------------------------------------------------------------------------
// Seed Page Section Parser
// ---------------------------------------------------------------------------

/**
 * 解析种子页面的 H2 章节结构，建立 URL → Section 映射。
 *
 * 例如 awesome-list 页面：
 * ```markdown
 * ## Multi-Agent Communication
 * - [Paper A](https://arxiv.org/abs/xxx)
 * - [Paper B](https://arxiv.org/abs/yyy)
 * ## Planning
 * - [Paper C](https://arxiv.org/abs/zzz)
 * ```
 * 返回 Map: { arxiv/xxx → "Multi-Agent Communication", arxiv/yyy → "Multi-Agent Communication", arxiv/zzz → "Planning" }
 */
function parseSeedPageSections(filePath: string): Map<string, string> {
  const urlToSection = new Map<string, string>()
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    let currentSection = ''

    for (const line of content.split('\n')) {
      // 跟踪 H2 标题作为分区标记
      const h2Match = line.match(/^##\s+(.+)/)
      if (h2Match) {
        const heading = h2Match[1].trim()
        // 跳过目录类标题
        if (!/^(table of contents|toc|links|references|目录)$/i.test(heading)) {
          currentSection = heading
        }
        continue
      }

      // 从 markdown 链接中提取 URL
      if (!currentSection) continue
      const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
      let match
      while ((match = linkRegex.exec(line)) !== null) {
        urlToSection.set(match[2], currentSection)
      }
    }
  } catch { /* ignore */ }
  return urlToSection
}

/**
 * 在已保存的 Markdown 文件中注入 Section 元数据行。
 * 插入在 `> Source:` 行之后，或文件顶部。
 */
function insertSectionMetadata(filePath: string, section: string): void {
  try {
    let content = fs.readFileSync(filePath, 'utf-8')
    const sectionLine = `> Section: ${section}`
    // 避免重复注入
    if (content.includes(sectionLine)) return

    const sourceMatch = content.match(/(>\s*Source:\s*[^\n]+\n)/)
    if (sourceMatch) {
      content = content.replace(sourceMatch[0], `${sourceMatch[0]}${sectionLine}\n`)
    } else {
      content = `${sectionLine}\n\n${content}`
    }
    fs.writeFileSync(filePath, content, 'utf-8')
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// PDF / Paper Direct Download
// ---------------------------------------------------------------------------

/**
 * 判断 URL 是否指向 PDF（arxiv/pdf 直链等）。
 */
function isPdfUrl(url: string): boolean {
  if (url.endsWith('.pdf')) return true
  // arxiv abs 或 pdf 页面
  if (/arxiv\.org\/(abs|pdf)\/\d+\.\d+/.test(url)) return true
  return false
}

/**
 * 将 arxiv abs URL 转为 PDF 下载 URL。
 */
function toPdfDownloadUrl(url: string): string {
  const m = url.match(/arxiv\.org\/abs\/(\d+\.\d+(?:v\d+)?)/)
  if (m) return `https://arxiv.org/pdf/${m[1]}`
  return url
}

/**
 * 直接下载 PDF 并转换为 Markdown（跳过 Agent，速度更快）。
 * 需要 markitdown 已安装。
 */
async function downloadPdfAsMarkdown(
  url: string,
  savePath: string,
): Promise<CrawlResult> {
  const pdfUrl = toPdfDownloadUrl(url)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-'))
  const pdfPath = path.join(tmpDir, 'paper.pdf')

  try {
    // 下载 PDF
    execFileSync('curl', [
      '-L', '--max-time', '120', '--retry', '3', '--retry-delay', '5',
      '-o', pdfPath,
      '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      pdfUrl,
    ], { timeout: 180_000 })

    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size < 1000) {
      return { saved: false }
    }

    // 转换为 Markdown
    const mdContent = execFileSync('markitdown', [pdfPath], {
      timeout: 300_000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })

    if (!mdContent || mdContent.trim().length < 100) {
      return { saved: false }
    }

    // 提取标题
    const titleMatch = mdContent.match(/^#\s+(.+)/m)
    const title = titleMatch?.[1]?.trim() || path.basename(pdfUrl, '.pdf')

    // 写入文件（带元数据头）
    const header = `> Source: ${url}\n> Downloaded: ${new Date().toISOString()}\n> Method: pdf-download\n\n`
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    fs.writeFileSync(savePath, header + mdContent, 'utf-8')

    return { saved: true, title }
  } catch {
    return { saved: false }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * 检查 markitdown 是否可用。
 */
let _markitdownAvailable: boolean | null = null
function isMarkitdownAvailable(): boolean {
  if (_markitdownAvailable !== null) return _markitdownAvailable
  try {
    execFileSync('which', ['markitdown'], { encoding: 'utf-8' })
    _markitdownAvailable = true
  } catch {
    _markitdownAvailable = false
  }
  return _markitdownAvailable
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAgentCrawlOutput(output: string): CrawlResult {
  // 寻找 JSON 块
  const jsonMatch = output.match(/\{[\s\S]*?"saved"\s*:[\s\S]*?\}/)
  if (!jsonMatch) {
    // 如果没有 JSON 输出但文件可能已保存，返回保守结果
    return { saved: true }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      saved: Boolean(parsed.saved),
      title: parsed.title as string | undefined,
      links: Array.isArray(parsed.links) ? parsed.links.filter((l: unknown) => typeof l === 'string') : undefined,
    }
  } catch {
    return { saved: true }
  }
}

function sanitizeFileName(name: string, maxLen = 80): string {
  return name
    .replace(/[^\w\u4e00-\u9fff\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .toLowerCase() || 'page'
}

function urlToFileName(url: string): string {
  try {
    const u = new URL(url)
    const pathPart = u.pathname.replace(/\//g, '-').replace(/^-|-$/g, '')
    return pathPart || u.hostname
  } catch {
    return 'page'
  }
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 从已保存的 Markdown 文件中提取标题（H1, H2）。
 */
function extractHeadings(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const headings: string[] = []
    for (const line of content.split('\n')) {
      const match = line.match(/^(#{1,2})\s+(.+)/)
      if (match) {
        headings.push(match[2].trim())
      }
    }
    return headings
  } catch {
    return []
  }
}

export { extractHeadings }
