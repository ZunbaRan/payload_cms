/**
 * @fileoverview Load an existing Deep Research workspace from disk.
 *
 * Parses index-reference.md to reconstruct SavedMaterial[] and
 * DeepResearchSearchResult without re-running the search phase.
 *
 * @example
 * ```ts
 * const result = loadWorkspace('output/harness-engineering-2026-04-21')
 * console.log(`Loaded ${result.materials.length} materials from existing workspace`)
 * ```
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  DeepResearchSearchResult,
  SavedMaterial,
  SearchWorkspace,
  SearchPlan,
} from './types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load an existing Deep Research workspace from disk.
 *
 * Reconstructs DeepResearchSearchResult by parsing the index-reference.md
 * file that was generated during the search phase. No re-crawling is done.
 *
 * @param workspaceDir - Absolute or process.cwd()-relative path to the workspace
 *   root directory (e.g., 'output/harness-engineering-2026-04-21')
 */
export function loadWorkspace(workspaceDir: string): DeepResearchSearchResult {
  const rootDir = path.resolve(workspaceDir)

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Workspace not found: ${rootDir}`)
  }

  // Reconstruct SearchWorkspace paths (mirrors workspace.ts layout)
  const materialsDir = path.join(rootDir, 'materials')
  const workspace: SearchWorkspace = {
    rootDir,
    materialsDir,
    searchDir: path.join(materialsDir, 'search'),
    seedsDir: path.join(materialsDir, 'seeds'),
    booksDir: path.join(materialsDir, 'books'),
    skillsDir: path.join(rootDir, '.claude', 'skills'),
    indexPath: path.join(rootDir, 'INDEX.md'),
    referenceIndexPath: path.join(rootDir, 'index-reference.md'),
    planPath: path.join(rootDir, 'search-plan.json'),
  }

  // Parse index-reference.md → SavedMaterial[]
  const materials = parseReferenceIndex(workspace.referenceIndexPath, materialsDir)

  // Load search plan if available (best-effort)
  let plan: SearchPlan = {
    goal: path.basename(rootDir).replace(/-\d{4}-\d{2}-\d{2}$/, ''),
    dimensions: [],
  }
  if (fs.existsSync(workspace.planPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(workspace.planPath, 'utf-8'))
      if (raw && typeof raw === 'object') plan = raw as SearchPlan
    } catch { /* use default */ }
  }

  // Stats
  const searchFiles = materials.filter(m => m.source === 'search').length
  const seedFiles = materials.filter(m => m.source === 'seed').length
  const bookFiles = materials.filter(m => m.source === 'book').length
  const dimensionIds = new Set(
    materials.filter(m => m.dimensionId).map(m => m.dimensionId!),
  )

  return {
    workspace,
    plan,
    materials,
    indexPath: workspace.indexPath,
    referenceIndexPath: workspace.referenceIndexPath,
    stats: {
      totalFiles: materials.length,
      searchFiles,
      seedFiles,
      bookFiles,
      totalDimensions: dimensionIds.size,
    },
  }
}

// ---------------------------------------------------------------------------
// index-reference.md Parser
// ---------------------------------------------------------------------------

/**
 * Parse index-reference.md table into SavedMaterial[].
 *
 * Expected table format:
 * ```
 * | 标题 | 来源 | 类型 | 文件路径 |
 * |------|------|------|---------|
 * | Title | dim-1 | 搜索 | `search/dim-1/01-xxx.md` |
 * ```
 */
function parseReferenceIndex(
  referenceIndexPath: string,
  materialsDir: string,
): SavedMaterial[] {
  if (!fs.existsSync(referenceIndexPath)) {
    console.warn(`[loadWorkspace] index-reference.md not found at ${referenceIndexPath}`)
    return []
  }

  const content = fs.readFileSync(referenceIndexPath, 'utf-8')
  const lines = content.split('\n')
  const materials: SavedMaterial[] = []
  let inTable = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue

    // Detect header row
    if (!inTable && trimmed.includes('标题') && trimmed.includes('文件路径')) {
      inTable = true
      continue
    }
    // Skip separator row: |---|---|---|---|
    if (trimmed.match(/^\|[\s-|]+\|$/)) continue
    if (!inTable) continue

    // Parse data row: | 标题 | 来源 | 类型 | 文件路径 |
    const cols = trimmed
      .split('|')
      .map(c => c.trim())
      .filter(c => c !== '')
    if (cols.length < 4) continue

    const title = cols[0]
    const sourceId = cols[1]   // dim-1, dim-2, harness-engineering, etc.
    const typeStr = cols[2]    // 搜索, 书籍章节, 种子
    const filePathRaw = cols[3]

    // Extract relative path from backticks: `search/dim-1/01-xxx.md`
    const relPathMatch = filePathRaw.match(/`([^`]+)`/)
    if (!relPathMatch) continue
    const relativePath = relPathMatch[1]

    const source = mapSourceType(typeStr)

    // For search files, extract dimensionId from path: search/{dimId}/file.md
    let dimensionId: string | undefined
    if (source === 'search') {
      const segments = relativePath.split('/')
      dimensionId = segments.length >= 2 ? segments[1] : sourceId
    }

    const absolutePath = path.join(materialsDir, relativePath)

    // Best-effort: extract headings & summary from existing file
    let headings: string[] | undefined
    let summary: string | undefined
    if (fs.existsSync(absolutePath)) {
      try {
        const fileContent = fs.readFileSync(absolutePath, 'utf-8')
        headings = extractHeadings(fileContent)
        summary = extractFirstParagraph(fileContent)
      } catch { /* skip enrichment */ }
    }

    materials.push({
      relativePath,
      absolutePath,
      source,
      dimensionId,
      title,
      headings,
      summary,
    })
  }

  return materials
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSourceType(typeStr: string): 'search' | 'seed' | 'book' {
  if (typeStr.includes('搜索') || typeStr.toLowerCase().includes('search')) return 'search'
  if (typeStr.includes('书籍') || typeStr.toLowerCase().includes('book')) return 'book'
  if (typeStr.includes('种子') || typeStr.toLowerCase().includes('seed')) return 'seed'
  return 'search' // default
}

function extractHeadings(content: string): string[] {
  const headings: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^#{1,3}\s+(.+)/)
    if (match) headings.push(match[1].trim())
    if (headings.length >= 5) break
  }
  return headings
}

function extractFirstParagraph(content: string): string {
  const lines = content.split('\n')
  let inFrontmatter = false
  let frontmatterEnded = false
  const paragraphLines: string[] = []

  for (const line of lines) {
    // Handle YAML frontmatter
    if (line.trim() === '---' && !frontmatterEnded) {
      if (!inFrontmatter) { inFrontmatter = true; continue }
      else { inFrontmatter = false; frontmatterEnded = true; continue }
    }
    if (inFrontmatter) continue

    // Skip headings
    if (line.startsWith('#')) continue
    // Skip empty lines before first paragraph
    if (!paragraphLines.length && !line.trim()) continue

    if (line.trim()) {
      paragraphLines.push(line.trim())
      if (paragraphLines.join(' ').length > 250) break
    } else if (paragraphLines.length > 0) {
      break // end of paragraph
    }
  }

  return paragraphLines.join(' ').slice(0, 250)
}
