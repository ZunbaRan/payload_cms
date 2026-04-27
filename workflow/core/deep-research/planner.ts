/**
 * @fileoverview Search Planner & Shared Prompt Templates.
 *
 * 搜索阶段 5：
 * - 如果用户指定了搜索维度 → 直接使用
 * - 如果没有 → Planner Agent 根据研究目标自动规划搜索维度
 *
 * 同时导出可复用的搜索提示词模板，兼容 course-creator 等上层流程。
 */

import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../agent/claude-agent.js'
import { z } from 'zod'
import type { SearchPlan, SearchDimension, SearchWorkspace } from './types.js'

// ---------------------------------------------------------------------------
// 可复用搜索工具规范（从 course-creator 提取并通用化）
// ---------------------------------------------------------------------------

/**
 * 搜索工具使用规范。
 * 可供上层项目（course-creator 等）直接引用。
 */
export const SEARCH_TOOL_GUIDELINES = `

## 搜索工具使用规范（⚠️ 必须遵守）

### Metaso 使用规则
1. **调用上限**：本任务调用 Metaso **不超过 2 次**，每次尽量用不同关键词。
2. **URL 抓取义务**：Metaso 每条结果都附带 URL，必须对 **Top 3 URL** 逐一调用 WebFetch / web-access skill 抓取**全文内容**，不得只依赖 Metaso 的 AI 摘要。
3. **抓取摘要写入输出**：抓取到的全文中，提取关键论点 / 数据 / 案例，写入最终 Output。

### 连续错误时的降级策略
- Metaso 连续出现 2 次及以上错误 → **立即停止调用 Metaso**，改用 **web-access skill**（CDP 真实浏览器）完成剩余搜索。
- 今日 Metaso 额度可能已耗尽，优先尝试 1 次，失败立刻降级，不要等待重试。

### 优先级顺序
1. Metaso（≤2 次）→ 2. 对返回 URL 调用 WebFetch → 3. 如 Metaso 失败 → web-access skill
`

/**
 * Searcher 保存规范：要求 Searcher 把搜索到的内容保存为本地 Markdown。
 */
export const SEARCH_SAVE_GUIDELINES = `

## 内容保存规范（⚠️ 必须遵守）

### 保存规则
1. 每个有价值的网页内容必须保存为 **独立的 Markdown 文件**
2. 保存路径：使用 file write 工具写入指定的 materials 目录
3. 文件命名：\`{序号}-{简短标题}.md\`，例如 \`01-openai-agent-overview.md\`
4. 文件内容格式：
   - 第一行：\`# {页面标题}\`
   - 第二行空行后：\`> Source: {URL}\`
   - 正文：完整的页面核心内容（保留代码块、表格、列表）
   - 去除导航栏、侧边栏、广告、cookie 提示等噪音

### 最终输出
搜索完成后，你的最终消息应该汇总：
- 搜索了多少个来源
- 保存了多少个文件
- 每个文件的 1 句话摘要
`

// ---------------------------------------------------------------------------
// 预置搜索维度模板（兼容 course-creator 的 4 维度）
// ---------------------------------------------------------------------------

/** 基础概念维度 */
export const DIM_FOUNDATIONS: Omit<SearchDimension, 'searchPrompt'> = {
  id: 'foundations',
  title: 'Foundational Concepts',
  systemPrompt: `You are a Researcher specializing in foundational concepts.
Goal: Find clear, simple explanations and analogies for [TOPIC].
Search Strategy:
1. Define the core concepts.
2. Find analogies suitable for non-technical audience.
3. Find authoritative definitions.
Output a structured summary with sources.` + SEARCH_TOOL_GUIDELINES,
}

/** 前沿趋势维度 */
export const DIM_FRONTIER: Omit<SearchDimension, 'searchPrompt'> = {
  id: 'frontier',
  title: 'Frontier Developments',
  systemPrompt: `You are a Researcher specializing in frontier developments.
Goal: Find the latest trends (2025-2026) regarding [TOPIC].
Search Strategy:
1. Check recent blogs from Anthropic, OpenAI, Google, Microsoft.
2. Find new capabilities or shifts in the paradigm.
3. Look for "State of AI" reports.
Output a list of key trends with evidence.` + SEARCH_TOOL_GUIDELINES,
}

/** 案例研究维度 */
export const DIM_CASES: Omit<SearchDimension, 'searchPrompt'> = {
  id: 'cases',
  title: 'Business Cases & Examples',
  systemPrompt: `You are a Researcher specializing in business cases.
Goal: Find real-world product examples and case studies for [TOPIC].
Search Strategy:
1. Look for "How Company X uses [TOPIC]".
2. Find success stories and failures.
3. Look for case studies in SaaS, Enterprise, or Consumer apps.
Output 3-5 detailed case summaries.` + SEARCH_TOOL_GUIDELINES,
}

/** 框架/方法论维度 */
export const DIM_FRAMEWORKS: Omit<SearchDimension, 'searchPrompt'> = {
  id: 'frameworks',
  title: 'Frameworks & Methodologies',
  systemPrompt: `You are a Researcher specializing in decision frameworks.
Goal: Find frameworks, checklists, and decision matrices for [TOPIC].
Search Strategy:
1. Look for guides and best practices.
2. Find evaluation metrics, risk assessments, or trade-off analyses.
3. Look for "How to choose..." guides.
Output practical frameworks.` + SEARCH_TOOL_GUIDELINES,
}

/** 全部预置维度 */
export const PRESET_DIMENSIONS = [DIM_FOUNDATIONS, DIM_FRONTIER, DIM_CASES, DIM_FRAMEWORKS] as const

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

const PlanSchema = z.object({
  goal: z.string(),
  isComplete: z.boolean().default(false),
  reasoning: z.string(),
  gaps: z.array(z.string()).default([]),
  dimensions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    searchFocus: z.string(),
  })),
})

type PlanRaw = z.infer<typeof PlanSchema>

const PLANNER_SYSTEM_PROMPT = `You are a Deep Research Planner & Reflector.

Your ONLY job: analyze the research goal, reflect on what has already been collected (External Memory), identify knowledge gaps, and plan the next targeted search dimensions — or declare research complete.

## Core Guidelines
1. **Restate** the main research goal to confirm understanding
2. **Reflect** on the External Memory (INDEX.md): what topics are well-covered? what is missing or shallow?
3. **Identify gaps**: distinct aspects that are absent, contradictory, or insufficiently covered
4. **Plan dimensions** — each must be self-contained, non-redundant, and solvable by a web search agent:
   - Iteration 1 (no prior findings): plan 3-6 broad dimensions for initial coverage
   - Iteration 2+ (with findings): plan 2-4 **targeted** dimensions filling specific gaps only
5. **Decide**: set isComplete=true if coverage across all key aspects is sufficient

## Dimension Design Rules
- Each dimension covers a **distinct** aspect (avoid overlap between dimensions)
- Consider: foundational concepts, frontier trends, practical cases, frameworks/tools, risks/limitations, comparisons
- searchFocus must be specific enough to guide a searcher agent (not just a topic name)
- Ensure every dimension is independently parallelizable

## Stop Condition — set isComplete=true when:
- All major aspects of the research goal are covered
- Remaining gaps are minor, tangential, or out of scope
- This is the final allowed iteration

## Output Format (strict JSON only — no markdown fences, no other text)
{
  "goal": "refined research goal",
  "isComplete": false,
  "reasoning": "concise analysis of current coverage and rationale for next dimensions",
  "gaps": ["specific gap 1", "specific gap 2"],
  "dimensions": [
    { "id": "dim-1", "title": "Dimension Title", "searchFocus": "Specific focus that fills an identified gap" }
  ]
}
`

/**
 * 根据研究目标自动规划搜索维度（支持多轮迭代）。
 *
 * 每轮注入当前 External Memory（INDEX.md 内容），
 * Planner 反思已有发现后决定是继续搜索还是宣布研究完整。
 *
 * @param goal        研究目标
 * @param workspace   工作区
 * @param sdkOptions  Agent SDK 选项
 * @param opts.extraPrompt    额外提示（可选）
 * @param opts.iteration      当前迭代号（从 1 开始）
 * @param opts.maxIterations  总迭代上限
 * @param opts.indexContent   当前 INDEX.md 内容（External Memory）
 * @returns 搜索计划（含 isComplete 判断）
 */
export async function planSearchDimensions(
  goal: string,
  workspace: SearchWorkspace,
  sdkOptions: Partial<ClaudeAgentOptions>,
  opts?: {
    extraPrompt?: string
    iteration?: number
    maxIterations?: number
    indexContent?: string
  },
): Promise<SearchPlan> {
  const { extraPrompt, iteration = 1, maxIterations = 3, indexContent = '' } = opts ?? {}

  const agent = new ClaudeAgent(
    {
      name: `search-planner-iter${iteration}`,
      model: sdkOptions.model ?? '',
      systemPrompt: PLANNER_SYSTEM_PROMPT + (extraPrompt ? `\n\n${extraPrompt}` : ''),
      maxTurns: 5,
    },
    {
      ...sdkOptions,
      cwd: workspace.rootDir,
      outputSchema: PlanSchema as any,
      allowedTools: [],
      injectNetworkRule: false,
      maxTurns: 5,
      timeoutMs: sdkOptions.timeoutMs ?? 30_000,
    },
  )

  const externalMemoryBlock = indexContent.trim()
    ? `## Current External Memory (INDEX.md)\n\`\`\`\n${indexContent.slice(0, 8000)}\n\`\`\``
    : '## Current External Memory\nNo materials collected yet.'

  const prompt = [
    `Research Goal: ${goal}`,
    ``,
    `Iteration: ${iteration} / ${maxIterations}`,
    ``,
    externalMemoryBlock,
    ``,
    `Based on the above, reflect on current coverage and plan the next targeted search dimensions.`,
    `If the research goal is already well-covered, set isComplete=true and return an empty dimensions array.`,
  ].join('\n')

  const result = await agent.run(prompt)
  const raw = (result.structured as PlanRaw) ?? parsePlanJson(result.output)

  const dimensions: SearchDimension[] = raw.dimensions.map(d => ({
    id: d.id,
    title: d.title,
    systemPrompt: buildSearcherPromptFromFocus(d.title, d.searchFocus),
    searchPrompt: d.searchFocus,
  }))

  return {
    goal: raw.goal || goal,
    dimensions,
    reasoning: raw.reasoning,
    isComplete: raw.isComplete,
    gaps: raw.gaps,
  }
}

/**
 * 当用户直接指定维度时，构建搜索计划（无需 Planner Agent）。
 */
export function buildPlanFromDimensions(
  goal: string,
  dimensions: SearchDimension[],
): SearchPlan {
  return { goal, dimensions }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSearcherPromptFromFocus(title: string, focus: string): string {
  return `You are a Researcher specializing in "${title}".
Goal: ${focus}

Search Strategy:
1. Use Metaso for initial high-quality results (max 2 calls)
2. Fetch full content from the top URLs returned
3. If Metaso fails, switch to web-access skill
4. Save ALL valuable content as local Markdown files

${SEARCH_TOOL_GUIDELINES}
${SEARCH_SAVE_GUIDELINES}`
}

function parsePlanJson(output: string): PlanRaw {
  // Strategy 1: Find JSON block with "dimensions"
  const jsonMatch = output.match(/\{[\s\S]*"dimensions"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return PlanSchema.parse(JSON.parse(jsonMatch[0]))
    } catch { /* fall through */ }
  }

  // Strategy 2: Find JSON inside markdown code fence
  const fenceMatch = output.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) {
    try {
      return PlanSchema.parse(JSON.parse(fenceMatch[1]))
    } catch { /* fall through */ }
  }

  // Strategy 3: Extract dimensions from markdown table rows
  // Matches rows like: | 1 | **Title** | Focus text |
  const tableRows = output.matchAll(/\|\s*\d+\s*\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*([^|]+?)\s*\|/g)
  const dims: { id: string; title: string; searchFocus: string }[] = []
  let idx = 0
  for (const row of tableRows) {
    idx++
    dims.push({
      id: `dim-${idx}`,
      title: row[1].trim(),
      searchFocus: row[2].trim(),
    })
  }
  if (dims.length >= 2) {
    return {
      goal: 'extracted from planner output',
      isComplete: false,
      reasoning: 'Parsed from markdown table',
      gaps: [],
      dimensions: dims,
    }
  }

  throw new Error('Planner did not produce valid JSON output')
}
