/**
 * @fileoverview Parallel Searcher.
 *
 * 搜索阶段 1：按维度并发执行搜索 Agent，每个 Agent：
 * - 使用 web-access / markdown-proxy / metaso skill 搜索
 * - 将搜索到的有价值内容保存为本地 Markdown 文件
 * - 每个维度的结果保存在 materials/search/{dimensionId}/ 目录下
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../agent/claude-agent.js'
import type { SearchDimension, SavedMaterial, SearchWorkspace } from './types.js'
import { SEARCH_SAVE_GUIDELINES } from './planner.js'

// ---------------------------------------------------------------------------
// Searcher Execution
// ---------------------------------------------------------------------------

/**
 * 并行执行多个维度的搜索。
 *
 * 采用分批并发（chunk-based），每批最多 maxConcurrency 个 Agent 同时运行。
 *
 * @param dimensions    - 搜索维度列表
 * @param topic         - 研究主题（用于替换 [TOPIC] 占位符）
 * @param workspace     - 工作区
 * @param sdkOptions    - Agent SDK 选项
 * @param maxConcurrency - 最大并发数
 * @param extraPrompt   - 追加到每个 Searcher 的额外提示
 * @param onProgress    - 进度回调
 * @returns 所有维度保存的材料列表
 */
export async function runParallelSearchers(
  dimensions: SearchDimension[],
  topic: string,
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
  maxConcurrency = 4,
  extraPrompt?: string,
  onProgress?: (msg: string) => void,
): Promise<SavedMaterial[]> {
  if (dimensions.length === 0) return []

  const allMaterials: SavedMaterial[] = []

  for (let i = 0; i < dimensions.length; i += maxConcurrency) {
    const batch = dimensions.slice(i, i + maxConcurrency)

    const batchPromises = batch.map(dim =>
      runSingleSearcher(dim, topic, workspace, sdkOptions, extraPrompt, onProgress),
    )

    const batchResults = await Promise.all(batchPromises)
    for (const materials of batchResults) {
      allMaterials.push(...materials)
    }
  }

  return allMaterials
}

// ---------------------------------------------------------------------------
// Single Dimension Searcher
// ---------------------------------------------------------------------------

async function runSingleSearcher(
  dimension: SearchDimension,
  topic: string,
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
  extraPrompt?: string,
  onProgress?: (msg: string) => void,
): Promise<SavedMaterial[]> {
  // 为该维度创建保存目录
  const dimDir = path.join(workspace.searchDir, dimension.id)
  fs.mkdirSync(dimDir, { recursive: true })

  onProgress?.(`[Search] Starting dimension: ${dimension.title}`)

  // 构建系统提示词（替换占位符 + 追加保存规范）
  const systemPrompt = dimension.systemPrompt.replace(/\[TOPIC\]/g, topic)
    + SEARCH_SAVE_GUIDELINES
    + (extraPrompt ? `\n\n${extraPrompt}` : '')

  // 构建用户 prompt
  const searchPrompt = dimension.searchPrompt
    ? dimension.searchPrompt.replace(/\[TOPIC\]/g, topic)
    : `Research the following topic thoroughly: ${topic}`

  const prompt = `${searchPrompt}

## 保存目录
将所有搜索到的有价值内容保存为 Markdown 文件到以下目录：
${dimDir}/

文件命名：\`{序号}-{简短英文标题}.md\`
例如：\`01-openai-agent-overview.md\`

请开始搜索并保存内容。`

  const agent = new ClaudeAgent(
    {
      name: `searcher-${dimension.id}`,
      model: sdkOptions.model ?? '',
      systemPrompt,
      maxTurns: sdkOptions.maxTurns ?? 60,
    },
    {
      ...sdkOptions,
      cwd: workspace.rootDir,
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      injectNetworkRule: true,
      maxTurns: sdkOptions.maxTurns ?? 60,
      timeoutMs: sdkOptions.timeoutMs ?? 180_000,
    },
  )

  try {
    await agent.run(prompt)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onProgress?.(`[Search] Dimension "${dimension.title}" failed: ${msg}`)
  }

  // 扫描该维度目录下实际保存的文件
  const materials = scanSavedMaterials(dimDir, workspace.materialsDir, dimension.id)
  onProgress?.(`[Search] Dimension "${dimension.title}" saved ${materials.length} files`)

  return materials
}

// ---------------------------------------------------------------------------
// File Scanner
// ---------------------------------------------------------------------------

/**
 * 扫描目录下所有 .md 文件，构建 SavedMaterial 列表。
 */
function scanSavedMaterials(
  dir: string,
  materialsDir: string,
  dimensionId: string,
): SavedMaterial[] {
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  return files.map(f => {
    const absPath = path.join(dir, f)
    const content = fs.readFileSync(absPath, 'utf-8')
    const headings = extractHeadingsFromContent(content)
    const title = headings[0] ?? f.replace('.md', '')
    const sourceUrl = extractSourceUrl(content)

    return {
      relativePath: path.relative(materialsDir, absPath),
      absolutePath: absPath,
      sourceUrl,
      source: 'search' as const,
      dimensionId,
      title,
      headings,
    }
  })
}

function extractHeadingsFromContent(content: string): string[] {
  const headings: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{1,2})\s+(.+)/)
    if (match) headings.push(match[2].trim())
  }
  return headings
}

function extractSourceUrl(content: string): string | undefined {
  // 匹配 "> Source: https://..." 格式
  const match = content.match(/>\s*Source:\s*(https?:\/\/\S+)/)
  return match?.[1]
}
