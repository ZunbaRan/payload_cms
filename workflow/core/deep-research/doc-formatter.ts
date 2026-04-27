/**
 * @fileoverview Document Formatter Agent.
 *
 * 对已保存的 Markdown 文件进行格式化处理：
 * 1. Agent 阅读原始内容，提取论文元信息（标题、作者、摘要）
 * 2. 重新组织为结构化 Markdown（清晰的标题层级 H1-H3）
 * 3. 生成大纲 outline（用于 INDEX.md）
 * 4. 保留原有元数据行（> Source:, > Section:, > Downloaded:）
 *
 * 设计：每个文件独立格式化，可并行。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../agent/claude-agent.js'

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const DOC_FORMATTER_SYSTEM_PROMPT = `You are a document formatter that converts raw academic paper Markdown into clean, well-structured Markdown.

## Input
You will receive the file path of a saved Markdown file. Read it, then rewrite it IN PLACE.

## Formatting Rules

1. **Preserve metadata lines** at the top: lines starting with \`>\` (Source, Section, Downloaded, Method). Keep them exactly as-is.

2. **Title**: Extract the actual paper title and make it a single H1 (\`# Title\`). Remove any arxiv IDs or garbled text from the title.

3. **Authors & Abstract**: If identifiable, format as:
   \`\`\`
   **Authors**: Author1, Author2, ...
   
   **Abstract**: The paper's abstract text...
   \`\`\`

4. **Section headings**: Use proper hierarchy:
   - \`## Section Name\` for major sections (Introduction, Methods, Results, etc.)
   - \`### Subsection Name\` for subsections
   - Fix garbled or broken headings from PDF conversion

5. **Clean up artifacts**: Remove:
   - Broken table formatting (pipe-separated gibberish)
   - Repeated header/footer text from PDF pages
   - Raw LaTeX that didn't convert properly
   - Garbled characters from font extraction failures
   - Navigation or boilerplate text

6. **Preserve meaningful content**: Keep all substantive text, equations (as-is), figures/tables that are readable, and references.

7. **Output a structured outline** at the very end of the file as an HTML comment:
   \`\`\`
   <!-- OUTLINE
   # Paper Title
   ## Section 1
   ### Subsection 1.1
   ## Section 2
   ...
   -->
   \`\`\`

## Execution
1. Read the file with the Read tool
2. Rewrite the file with the Write tool — the FULL formatted content
3. Output: {"formatted": true, "title": "Actual Paper Title"}

## RULES
- Do NOT use Bash to read or write. Use Read and Write tools directly.
- Do NOT summarize or shorten the content. Keep ALL substantive text.
- If the file is already well-formatted or too short (<200 chars), output: {"formatted": false, "reason": "already clean"}
- Complete in ≤3 tool calls.
`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormatResult {
  filePath: string
  formatted: boolean
  title?: string
  outline?: string[]
}

/**
 * 对单个 Markdown 文件进行格式化。
 *
 * @param filePath 已保存的 Markdown 文件绝对路径
 * @param sdkOptions ClaudeAgent SDK 选项
 * @returns 格式化结果
 */
export async function formatDocument(
  filePath: string,
  sdkOptions: Partial<ClaudeAgentOptions>,
): Promise<FormatResult> {
  // 跳过不存在或太小的文件
  if (!fs.existsSync(filePath)) {
    return { filePath, formatted: false }
  }
  const stat = fs.statSync(filePath)
  if (stat.size < 200) {
    return { filePath, formatted: false }
  }

  // 跳过种子目录页（index.md）
  if (path.basename(filePath) === 'index.md') {
    return { filePath, formatted: false }
  }

  const agent = new ClaudeAgent(
    {
      name: 'doc-formatter',
      model: sdkOptions.model ?? '',
      systemPrompt: DOC_FORMATTER_SYSTEM_PROMPT,
      maxTurns: 5,
    },
    {
      ...sdkOptions,
      permissionMode: 'bypassPermissions',
      maxTurns: 5,
      timeoutMs: sdkOptions.timeoutMs ?? 120_000,
    },
  )

  const prompt = `Format the following document file:\n${filePath}\n\nRead it, reformat it, and write it back.`

  try {
    const result = await agent.run(prompt)
    const parsed = parseFormatterOutput(result.output)

    // 从格式化后的文件中提取 outline
    const outline = extractOutlineFromFile(filePath)

    return {
      filePath,
      formatted: parsed.formatted,
      title: parsed.title,
      outline,
    }
  } catch {
    return { filePath, formatted: false }
  }
}

/**
 * 批量格式化多个文件（并行，带并发控制）。
 */
export async function formatDocuments(
  filePaths: string[],
  sdkOptions: Partial<ClaudeAgentOptions>,
  concurrency = 3,
  onProgress?: (msg: string) => void,
): Promise<FormatResult[]> {
  const results: FormatResult[] = []
  const total = filePaths.length

  onProgress?.(`  [Formatter] Formatting ${total} documents with concurrency=${concurrency}...`)

  for (let i = 0; i < total; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map(async (fp, j) => {
        const idx = i + j + 1
        onProgress?.(`  [Formatter ${idx}/${total}] ${path.basename(fp)}`)
        return formatDocument(fp, sdkOptions)
      }),
    )

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
        if (r.value.formatted) {
          onProgress?.(`  [Formatter] ✓ ${path.basename(r.value.filePath)} → "${r.value.title}"`)
        }
      } else {
        onProgress?.(`  [Formatter] ✗ Failed: ${r.reason}`)
      }
    }
  }

  const formatted = results.filter(r => r.formatted).length
  onProgress?.(`  [Formatter] Done: ${formatted}/${total} documents formatted`)

  return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFormatterOutput(output: string): { formatted: boolean; title?: string } {
  const jsonMatch = output.match(/\{[\s\S]*?"formatted"\s*:[\s\S]*?\}/)
  if (!jsonMatch) return { formatted: true }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      formatted: Boolean(parsed.formatted),
      title: parsed.title as string | undefined,
    }
  } catch {
    return { formatted: true }
  }
}

/**
 * 从文件末尾的 <!-- OUTLINE ... --> 注释中提取大纲。
 */
function extractOutlineFromFile(filePath: string): string[] | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const match = content.match(/<!--\s*OUTLINE\s*\n([\s\S]*?)-->/)
    if (!match) return undefined

    const outlineLines = match[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('#'))

    return outlineLines.length > 0 ? outlineLines : undefined
  } catch {
    return undefined
  }
}
