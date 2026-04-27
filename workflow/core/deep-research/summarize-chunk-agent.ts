/**
 * @fileoverview Chunk Summarizer Agent — 通用标题+摘要提炼。
 *
 * 用轻量 ClaudeAgent（maxTurns: 2）对任意文本片段提炼：
 * - title:   简洁标题（5-10 词）
 * - summary: 一句话摘要（≤100 字符）
 *
 * 适用场景：
 * 1. 无目录书籍按字符拆分的 chunk
 * 2. 搜索/种子抓取的每个网页
 */

import { createClaudeAgent } from '../agent/claude-agent.js'
import { extractJSON } from '../agent/structured-output.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChunkSummary {
  /** 简洁标题（5-10 词） */
  title: string
  /** 一句话摘要，最长 100 字符 */
  summary: string
}

// ---------------------------------------------------------------------------
// Single-item Summarizer
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a precise document summarizer. ' +
  'Given text, output ONLY a JSON object with no markdown fences:\n' +
  '{"title":"concise title 5-10 words","summary":"one sentence max 100 chars"}'

/**
 * 用 ClaudeAgent 对单段内容生成 { title, summary }。
 *
 * @param content   待摘要的文本（内部截取前 3000 字）
 * @param opts.index  当前序号（用于 Agent 命名和进度提示）
 * @param opts.total  总数
 * @param opts.model  模型（留空使用环境变量 DEFAULT_MODEL）
 */
export async function summarizeChunk(
  content: string,
  opts: { index?: number; total?: number; model?: string } = {},
): Promise<ChunkSummary> {
  const { index = 1, total = 1, model } = opts

  // Flash 模型专用 API 配置（优先级：FLASH_* > 全局 ANTHROPIC_*）
  const summarizeBaseUrl = process.env.FLASH_BASE_URL
  const summarizeAuthToken = process.env.FLASH_AUTH_TOKEN
  const summarizeModel = model || process.env.FLASH_MODEL

  try {
    const agentId = `chunk-summarizer-${index}-${Date.now()}`
    const agent = createClaudeAgent(agentId, {
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions',
      maxTurns: 2,
      ...(summarizeModel ? { model: summarizeModel } : {}),
      ...(summarizeBaseUrl || summarizeAuthToken
        ? {
            env: {
              ...(summarizeBaseUrl ? { ANTHROPIC_BASE_URL: summarizeBaseUrl } : {}),
              ...(summarizeAuthToken
                ? { ANTHROPIC_API_KEY: summarizeAuthToken, ANTHROPIC_AUTH_TOKEN: summarizeAuthToken }
                : {}),
            },
          }
        : {}),
    })

    const result = await agent.run(
      `Item ${index}/${total}. Summarize:\n\n${content.slice(0, 3000)}`,
    )

    const parsed = extractJSON(result.output) as { title?: string; summary?: string } | null
    if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
      return {
        title: parsed.title.trim(),
        summary: (parsed.summary ?? '').slice(0, 120).trim(),
      }
    }
  } catch { /* fall through to default */ }

  return { title: `Section ${index}`, summary: '' }
}

// ---------------------------------------------------------------------------
// Parallel Batch Summarizer
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 8

/**
 * 并行批量对多个 chunk/网页生成 { title, summary }。
 *
 * 默认并发数 8，按批次处理以避免 API 限流。
 *
 * @param chunks      待处理列表，每项含 { index, content }
 * @param model       模型名称
 * @param onProgress  进度回调
 * @param concurrency 最大并发数（默认 8）
 */
export async function summarizeChunksInParallel(
  chunks: Array<{ index: number; content: string }>,
  model: string,
  onProgress?: (msg: string) => void,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<ChunkSummary[]> {
  if (chunks.length === 0) return []

  onProgress?.(
    `[Summarizer] ${chunks.length} items, concurrency=${concurrency}, model=${model || 'default'}`,
  )

  const results: ChunkSummary[] = new Array(chunks.length)

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(c =>
        summarizeChunk(c.content, { index: c.index, total: chunks.length, model }),
      ),
    )
    batchResults.forEach((r, j) => { results[i + j] = r })

    const done = Math.min(i + concurrency, chunks.length)
    onProgress?.(`[Summarizer] Batch done: ${done}/${chunks.length}`)
  }

  return results
}
