/**
 * @fileoverview Auto-Research Pipeline (迭代优化)
 *
 * 每个节点（Generator / Scorer / Decider / Rewriter）都是可注入的 async 函数，
 * 可以是单一 ClaudeAgent、Agent Team、子管道、纯逻辑函数——任意 async (ctx) => T。
 *
 * 注入方式：
 *   1. 传入完整节点函数（generatorNode / scorerNode / ...）—— 最高优先级
 *   2. 传入 prompt 字符串（generatorPrompt / scorerPrompt / ...）
 *      —— 框架自动构建默认 ClaudeAgent 节点（向后兼容）
 *
 * 导出的工厂函数：
 *   makeAgentGeneratorNode  — 用 systemPrompt 构建 GeneratorNode
 *   makeAgentRewriterNode   — 用 systemPrompt 构建 RewriterNode
 *   makeScoreModeScorer     — LLM + 结构化 JSON 评分（score 模式）
 *   makeYesNoScorerNode     — rubric 项逐一 true/false 评分（yesno 模式）
 *   makeScoreModeDecider    — LLM 决策节点（score 模式）
 *   makeYesNoDeciderNode    — 纯逻辑决策节点，无 LLM 调用（yesno 模式）
 *   buildGeneratorPrompt    — 供自定义节点复用的上下文构建器
 *   buildRewriterPrompt     — 供自定义节点复用的上下文构建器
 */

import { ClaudeAgent } from '../agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../agent/claude-agent.js'
import type {
  AutoResearchOptions,
  AutoResearchResult,
  IterationRecord,
  ScoreReport,
  Rubric,
  GeneratorNode,
  ScorerNode,
  DeciderNode,
  RewriterNode,
  GeneratorContext,
  ScorerContext,
  DeciderContext,
  RewriterContext,
} from '../types.js'
import * as path from 'node:path'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Zod Schemas (used inside node factories)
// ---------------------------------------------------------------------------

const ScoreReportSchema = z.object({
  objective: z.record(z.string(), z.boolean().describe('该项是否通过')),
  subjectiveScore: z.number().describe('主观打分 1-10'),
  feedback: z.string().describe('具体的改进建议'),
})

type ScoreReportRaw = z.infer<typeof ScoreReportSchema>

const DeciderSchema = z.object({
  action: z.enum(['pass', 'rewrite', 'regenerate']),
  reason: z.string().describe('决策原因'),
})

type DeciderRaw = z.infer<typeof DeciderSchema>

const YesNoSchema = z.object({
  rubric: z.record(z.string(), z.boolean()),
  feedback: z.string(),
})

type YesNoRaw = z.infer<typeof YesNoSchema>

// ---------------------------------------------------------------------------
// Default Prompts
// ---------------------------------------------------------------------------

const DEFAULT_GENERATOR_PROMPT = `你是一个资深内容创作者，擅长根据目标产出高质量内容。

## 工作原则
1. 先理解目标的核心诉求，再动笔
2. 如果目标模糊，按"信息完整 > 逻辑清晰 > 表达生动"的优先级补全
3. 输出必须是完整可用的内容，不要留占位符或"待补充"
4. 如果某些信息无法获取，明确标注"未找到"而非留空

## 通用质量标准
- 结构：有清晰的开头、主体、结尾
- 信息：覆盖目标提到的所有要点，不遗漏
- 表达：用词准确，避免空洞套话
- 长度：与目标复杂度匹配，不注水也不缩水

## 禁止行为
- ❌ 不要输出"（待补充）"、"TODO"、"待完善"等占位符
- ❌ 不要输出"让我先..."、"我来帮你..."等过程性描述
- ❌ 不要只输出大纲或概要，必须输出完整正文

## 如果信息不足
- 合理推断，但标注假设前提
- 宁可多写一点，不要缺斤少两`

const DEFAULT_SCORER_PROMPT = `你是一个严格的内容评审官。你的打分直接影响内容是否被采用。

## 评分维度

### 客观检查（逐项判断 Yes/No）
1. 完整性：是否覆盖了所有要求的要点？
2. 准确性：是否有事实错误或逻辑矛盾？
3. 结构：是否有清晰的组织结构？
4. 格式：是否符合要求的格式规范？

### 主观打分（1-10）
- 1-3：不可用，需要大改
- 4-6：可用但粗糙，有明显改进空间
- 7-8：良好，只有小瑕疵
- 9-10：优秀，几乎无需修改

## 打分原则
- 严格但不苛刻：有明显缺陷就扣分，不因"态度好"放水
- 具体反馈：指出哪一段、什么问题、怎么改
- 不要给中间分：能判断 Yes 就给 Yes，犹豫就是 No`

const DEFAULT_DECIDER_PROMPT = `你是一个内容迭代决策官。你的职责是用最少的迭代次数产出达标内容。

## 决策树

### pass（通过）
条件：总分 >= 阈值 且 没有致命缺陷
- 即使有小瑕疵，只要达标就 pass，不要追求完美

### rewrite（重写）
条件：总分 < 阈值 且 反馈指出了具体可改进项
- 如果最近 2 轮分数持续上升（每轮涨 >= 5%），继续 rewrite
- 如果反馈集中在同一问题上，说明 Rewriter 没理解，考虑 regenerate

### regenerate（重来）
条件：满足以下任一
- 连续 3 轮分数变化 < 5%（停滞）
- 最近 2 轮分数下降
- 反馈指出"方向性错误"或"需要完全不同 approach"
- rewrite 超过 5 次仍未达标

## 决策优先级
pass > regenerate > rewrite
- 能 pass 就 pass，不要为了"更好"而拒绝
- 方向错了就重来，不要在错误基础上修修补补
- 其他情况都选 rewrite

## 输出要求
- action 必须三选一
- reason 用一句话说清为什么选这个`

const DEFAULT_REWRITER_PROMPT = `你是一个资深编辑，擅长根据反馈精准修改内容。

## 工作原则
1. 先读反馈，定位问题所在的具体段落
2. 只改有问题的部分，不要重写没问题的内容
3. 保持原文的风格和语气，除非反馈明确要求改变

## 处理矛盾反馈
- 如果不同轮次的反馈冲突，以最近一轮为准
- 如果同一轮反馈自相矛盾，优先解决"完整性"问题，再解决"风格"问题

## 重写幅度
- 局部问题（某段表述不清）：只改那一段
- 结构问题（组织混乱）：重组段落顺序，保留内容
- 方向问题（整体不对）：大幅重写，但保留可用的素材

## 输出要求
- 输出完整修改后的内容，不要只输出修改部分
- 不要添加原文没有的新内容，除非反馈明确要求`

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function resolveClaudeCodeExecutablePath(explicitPath?: string): string {
  if (explicitPath) return explicitPath
  if (process.env.CLAUDE_AGENT_EXECUTABLE_PATH) {
    return process.env.CLAUDE_AGENT_EXECUTABLE_PATH
  }
  return path.join(
    process.cwd(),
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'cli.js',
  )
}

export function makeSDKOptions(model: string, maxTurns: number, timeoutMs: number): ClaudeAgentOptions {
  return {
    model,
    maxTurns,
    timeoutMs,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
    },
    pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(
      process.env.CLAUDE_AGENT_EXECUTABLE_PATH,
    ),
  }
}

function rubricToString(rubric: Rubric): string {
  const lines = ['## Rubric']
  lines.push('### Objective Checklist (Yes/No)')
  for (const item of rubric.objective) {
    const reverseHint = item.reverse
      ? `\n  ⚠️ 反向指标：如果"${item.question}"为"是"，则不得分；只有"否"才得分。`
      : ''
    lines.push(`- ${item.id}: ${item.question} (Weight: ${item.weight ?? 1})${reverseHint}`)
  }
  lines.push(`\n### Subjective Feeling (1-10)`)
  lines.push(`- ${rubric.subjective.question} (Threshold: ${rubric.subjective.threshold})`)
  return lines.join('\n')
}

function parseScoreReport(parsed: ScoreReportRaw, rubric: Rubric): ScoreReport {
  const objectiveScores = rubric.objective.map(item => {
    const rawPassed = !!parsed.objective?.[item.id]
    const passed = item.reverse ? !rawPassed : rawPassed
    const weight = item.weight ?? 1
    return { id: item.id, passed, weight, score: passed ? weight : 0 }
  })

  const totalObjectiveScore = objectiveScores.reduce((s, i) => s + i.score, 0)
  const maxObjectiveScore = objectiveScores.reduce((s, i) => s + i.weight, 0)

  const subj = rubric.subjective
  const subjectiveScore = Math.min(10, Math.max(1, Number(parsed.subjectiveScore) || 0))
  const subjectiveWeight = subj.weight ?? 1
  const normalizedSubjective = (subjectiveScore / 10) * subjectiveWeight

  const maxTotal = maxObjectiveScore + subjectiveWeight
  const totalScore = maxTotal > 0 ? (totalObjectiveScore + normalizedSubjective) / maxTotal : 0

  return {
    objective: objectiveScores,
    subjectiveScore,
    subjectiveWeight,
    totalScore,
    feedback: parsed.feedback || 'No feedback provided.',
  }
}

function extractScoreFromMarkdown(output: string, rubric: Rubric): ScoreReport {
  const objective = rubric.objective.map(item => {
    const regex = new RegExp(`${item.id}.*?(✅|Yes|是|Pass|通过|❌|No|否|Fail|未通过)`, 'is')
    const match = output.match(regex)
    const isPositive = match ? /(✅|Yes|是|Pass|通过)/.test(match[0]) : false
    const passed = item.reverse ? !isPositive : isPositive
    const weight = item.weight ?? 1
    return { id: item.id, passed, weight, score: passed ? weight : 0 }
  })

  const subjMatch = output.match(/主观.*?(\d+).*?[/\/]\s*10|(\d+).*?[/\/]\s*10.*?主观|subjective.*?(\d+)/is)
  const subjectiveScore = Number(subjMatch?.[1] || subjMatch?.[2] || subjMatch?.[3] || 0)

  const feedbackMatch = output.match(/(?:反馈|建议|改进|Feedback)[:：\s]*(.+?)(?:\n\n|$)/is)
  const feedback = feedbackMatch?.[1]?.trim() || output.slice(0, 300)

  const totalObjectiveScore = objective.reduce((s, i) => s + i.score, 0)
  const maxObjectiveScore = objective.reduce((s, i) => s + i.weight, 0)
  const subj = rubric.subjective
  const subjectiveWeight = subj.weight ?? 1
  const normalizedSubjective = (Math.min(10, Math.max(1, subjectiveScore)) / 10) * subjectiveWeight
  const maxTotal = maxObjectiveScore + subjectiveWeight
  const totalScore = maxTotal > 0 ? (totalObjectiveScore + normalizedSubjective) / maxTotal : 0

  return { objective, subjectiveScore, subjectiveWeight, totalScore, feedback }
}

// ---------------------------------------------------------------------------
// Exported Context Builders (useful when writing custom nodes)
// ---------------------------------------------------------------------------

/**
 * Build a standard prompt string for a Generator/Rewriter node from GeneratorContext.
 * Export this so custom nodes can reuse the history-formatting logic.
 */
export function buildGeneratorPrompt(ctx: GeneratorContext, maxHistory = 5): string {
  const lines = [`## 目标\n${ctx.goal}\n`]

  const recentHistory = (ctx.isRegenerate ? [] : ctx.history).slice(-maxHistory)
  if (recentHistory.length > 0) {
    lines.push('## 迭代历史 (最近几轮)')
    for (const record of recentHistory) {
      lines.push(`\n### Round ${record.round} [${record.action.toUpperCase()}]`)
      lines.push(`- 分数: ${(record.scoreReport.totalScore * 100).toFixed(1)}%`)
      lines.push(`- 反馈: ${record.scoreReport.feedback}`)
      lines.push(`- 内容预览: ${record.content.slice(0, 150)}...`)
    }
  }

  const instruction = ctx.isRegenerate
    ? '清空思路，从头重新生成。忽略之前所有失败尝试，以全新视角创作。'
    : '请生成初稿。'

  lines.push(`\n## 当前指令\n${instruction}`)
  lines.push('\n请开始。')
  return lines.join('\n')
}

/**
 * Build a standard prompt string for a Rewriter node from RewriterContext.
 * Export this so custom nodes can reuse the history-formatting logic.
 */
export function buildRewriterPrompt(ctx: RewriterContext, maxHistory = 5): string {
  const lines = [`## 目标\n${ctx.goal}\n`]

  const recentHistory = ctx.history.slice(-maxHistory)
  if (recentHistory.length > 0) {
    lines.push('## 迭代历史 (最近几轮)')
    for (const record of recentHistory) {
      lines.push(`\n### Round ${record.round} [${record.action.toUpperCase()}]`)
      lines.push(`- 分数: ${(record.scoreReport.totalScore * 100).toFixed(1)}%`)
      lines.push(`- 反馈: ${record.scoreReport.feedback}`)
    }
  }

  lines.push('\n## 待修改内容（上一轮完整输出）')
  lines.push(ctx.content)

  lines.push('\n## 当前指令\n请根据以上反馈进行定向修改。重点关注最近一轮的未通过项，已通过项保持不变，输出完整修改后的内容。')
  lines.push('\n请开始。')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Node Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a GeneratorNode backed by a single ClaudeAgent with the given systemPrompt.
 */
export function makeAgentGeneratorNode(
  prompt: string,
  sdkOptions: ClaudeAgentOptions,
  maxHistory = 5,
): GeneratorNode {
  const agent = new ClaudeAgent(
    { name: 'generator', systemPrompt: prompt },
    { ...sdkOptions, allowedTools: ['Write', 'Edit'] },
  )
  return async (ctx: GeneratorContext): Promise<string> => {
    return (await agent.run(buildGeneratorPrompt(ctx, maxHistory))).output
  }
}

/**
 * Create a RewriterNode backed by a single ClaudeAgent with the given systemPrompt.
 */
export function makeAgentRewriterNode(
  prompt: string,
  sdkOptions: ClaudeAgentOptions,
  maxHistory = 5,
): RewriterNode {
  const agent = new ClaudeAgent(
    { name: 'rewriter', systemPrompt: prompt },
    { ...sdkOptions, allowedTools: ['Write', 'Edit'] },
  )
  return async (ctx: RewriterContext): Promise<string> => {
    return (await agent.run(buildRewriterPrompt(ctx, maxHistory))).output
  }
}

/**
 * Create a score-mode ScorerNode: LLM evaluates content and returns numeric scores.
 * Uses structured JSON output (ScoreReportSchema) with markdown fallback.
 */
export function makeScoreModeScorer(
  prompt: string,
  sdkOptions: ClaudeAgentOptions,
): ScorerNode {
  const agent = new ClaudeAgent(
    { name: 'scorer', systemPrompt: prompt },
    { ...sdkOptions, outputSchema: ScoreReportSchema as any },
  )
  return async (ctx: ScorerContext): Promise<ScoreReport> => {
    const promptText = [
      '请根据以下标准对内容进行打分。',
      '',
      `## 评分标准\n${rubricToString(ctx.rubric)}`,
      `## 待评审内容\n${ctx.content}`,
    ].join('\n')
    const result = await agent.run(promptText)
    if (result.structured) return parseScoreReport(result.structured as ScoreReportRaw, ctx.rubric)
    const cleaned = result.output.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try { return parseScoreReport(JSON.parse(jsonMatch[0]), ctx.rubric) } catch { /* fallback */ }
    }
    return extractScoreFromMarkdown(result.output, ctx.rubric)
  }
}

/**
 * Create a yes/no ScorerNode: LLM checks each rubric item as true/false.
 * No subjective score — total is purely objective pass/fail weighted.
 * Suitable for course-explainer and similar pass/fail rubric scenarios.
 */
export function makeYesNoScorerNode(
  prompt: string,
  sdkOptions: ClaudeAgentOptions,
): ScorerNode {
  const agent = new ClaudeAgent(
    { name: 'yesno-scorer', systemPrompt: prompt },
    { ...sdkOptions, outputSchema: YesNoSchema as any },
  )
  return async (ctx: ScorerContext): Promise<ScoreReport> => {
    const rubricItems = ctx.rubric.objective.map(i => ({ id: i.id, question: i.question }))
    const promptText = [
      '## 评审目标',
      ctx.goal,
      '',
      '## Rubric 检查项',
      ...rubricItems.map(i => `- ${i.id}: ${i.question}`),
      '',
      '## 待评审内容',
      ctx.content,
      '',
      '请逐项检查 rubric，返回 yes/no 结果和具体反馈。',
    ].join('\n')
    const result = await agent.run(promptText)

    let parsed: YesNoRaw
    if (result.structured) {
      parsed = result.structured as YesNoRaw
    } else {
      const cleaned = result.output.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('YesNo scorer did not return valid JSON')
      parsed = JSON.parse(jsonMatch[0])
    }

    const objectiveScores = ctx.rubric.objective.map(item => {
      const rawPassed = !!parsed.rubric?.[item.id]
      const passed = item.reverse ? !rawPassed : rawPassed
      const weight = item.weight ?? 1
      return { id: item.id, passed, weight, score: passed ? weight : 0 }
    })
    const totalObjectiveScore = objectiveScores.reduce((s, i) => s + i.score, 0)
    const maxObjectiveScore = objectiveScores.reduce((s, i) => s + i.weight, 0)
    const totalScore = maxObjectiveScore > 0 ? totalObjectiveScore / maxObjectiveScore : 0

    return {
      objective: objectiveScores,
      subjectiveScore: 0,
      subjectiveWeight: 0,
      totalScore,
      feedback: parsed.feedback || 'No feedback.',
    }
  }
}

/**
 * Create a score-mode DeciderNode: LLM decides pass/rewrite/regenerate
 * based on score and history.
 */
export function makeScoreModeDecider(
  prompt: string,
  sdkOptions: ClaudeAgentOptions,
  maxHistory = 5,
): DeciderNode {
  const agent = new ClaudeAgent(
    { name: 'decider', systemPrompt: prompt },
    { ...sdkOptions, outputSchema: DeciderSchema as any },
  )
  return async (ctx: DeciderContext): Promise<{ action: 'pass' | 'rewrite' | 'regenerate'; reason: string }> => {
    const lines = [`## 目标\n${ctx.goal}\n`]
    lines.push('## 评分标准摘要')
    lines.push(`- 客观题: ${ctx.rubric.objective.length} 项 (总分: ${ctx.rubric.objective.reduce((s, i) => s + (i.weight ?? 1), 0)})`)
    lines.push(`- 主观阈值: ${ctx.rubric.subjective.threshold}/10`)
    lines.push(`- 通过线: ${(ctx.passThreshold * 100).toFixed(0)}%`)

    const recent = ctx.history.slice(-maxHistory)
    if (recent.length > 0) {
      lines.push('\n## 迭代历史')
      for (const h of recent) {
        lines.push(`\n### Round ${h.round} [${h.action.toUpperCase()}]`)
        lines.push(`- 分数: ${(h.scoreReport.totalScore * 100).toFixed(1)}%`)
        lines.push(`- 反馈: ${h.scoreReport.feedback}`)
      }
    }

    lines.push(`\n## 当前指令\n当前分数为 ${(ctx.scoreReport.totalScore * 100).toFixed(1)}%（阈值: ${(ctx.passThreshold * 100).toFixed(1)}%）。请决定下一步（pass/rewrite/regenerate）并说明原因。`)
    lines.push('\n请决定下一步。')

    const result = await agent.run(lines.join('\n'))
    if (result.structured) return result.structured as DeciderRaw

    const cleaned = result.output.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]) } catch { /* fallback */ }
    }
    const actionMatch = cleaned.match(/(pass|rewrite|regenerate)/i)
    return {
      action: (actionMatch?.[1]?.toLowerCase() || 'rewrite') as 'pass' | 'rewrite' | 'regenerate',
      reason: cleaned.slice(0, 200),
    }
  }
}

/**
 * Create a yes/no DeciderNode: pure logic, no LLM call.
 * Passes when all required rubric items pass; rewrites otherwise.
 * Regenerates only when maxRounds is reached with failures remaining.
 *
 * @param maxRounds   Maximum rounds (= pipeline's maxIterations)
 * @param requiredIds If provided, only these rubric IDs are blocking.
 *                    Items not in requiredIds are non-blocking (informational only).
 */
export function makeYesNoDeciderNode(
  maxRounds: number,
  requiredIds?: readonly string[],
): DeciderNode {
  return async (ctx: DeciderContext): Promise<{ action: 'pass' | 'rewrite' | 'regenerate'; reason: string }> => {
    const failedItems =
      requiredIds && requiredIds.length > 0
        ? ctx.scoreReport.objective.filter(i => !i.passed && requiredIds.includes(i.id))
        : ctx.scoreReport.objective.filter(i => !i.passed)

    if (failedItems.length === 0) {
      const optFailed = ctx.scoreReport.objective.filter(i => !i.passed)
      const suffix =
        optFailed.length > 0
          ? ` (optional items ${optFailed.map(i => i.id).join(', ')} not passed but non-blocking)`
          : ''
      return { action: 'pass', reason: `All required items passed.${suffix}` }
    }

    if (ctx.round >= maxRounds) {
      return {
        action: 'regenerate',
        reason: `Max rounds (${maxRounds}) reached with items ${failedItems.map(i => i.id).join(', ')} still failing.`,
      }
    }

    return { action: 'rewrite', reason: `Required items failed: ${failedItems.map(i => i.id).join(', ')}.` }
  }
}

// ---------------------------------------------------------------------------
// AutoResearchPipeline
// ---------------------------------------------------------------------------

export class AutoResearchPipeline {
  private readonly maxIterations: number
  private readonly passThreshold: number
  private readonly rubric: Rubric
  private readonly maxHistory = 5
  private readonly stagnationThreshold = 3

  private readonly generatorNode: GeneratorNode
  private readonly scorerNode: ScorerNode
  private readonly deciderNode: DeciderNode
  private readonly rewriterNode: RewriterNode

  constructor(options: AutoResearchOptions) {
    this.maxIterations = options.maxIterations ?? 10
    this.passThreshold = options.passThreshold ?? 0.8
    this.rubric = options.rubric

    const model = options.model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6'
    const maxTurns = options.maxTurns ?? 20
    const timeoutMs = options.timeoutMs ?? 60000
    const sdkOptions = makeSDKOptions(model, maxTurns, timeoutMs)

    // Use injected nodes when provided; fall back to prompt-based defaults
    this.generatorNode =
      options.generatorNode ??
      makeAgentGeneratorNode(
        options.generatorPrompt || DEFAULT_GENERATOR_PROMPT,
        sdkOptions,
        this.maxHistory,
      )

    this.scorerNode =
      options.scorerNode ??
      makeScoreModeScorer(options.scorerPrompt || DEFAULT_SCORER_PROMPT, sdkOptions)

    this.deciderNode =
      options.deciderNode ??
      makeScoreModeDecider(
        options.deciderPrompt || DEFAULT_DECIDER_PROMPT,
        sdkOptions,
        this.maxHistory,
      )

    this.rewriterNode =
      options.rewriterNode ??
      makeAgentRewriterNode(
        options.rewriterPrompt || DEFAULT_REWRITER_PROMPT,
        sdkOptions,
        this.maxHistory,
      )
  }

  async run(goal: string): Promise<AutoResearchResult> {
    const history: IterationRecord[] = []
    const { maxIterations, passThreshold, rubric } = this

    for (let round = 1; round <= maxIterations; round++) {
      const needsRegenerate = round > 1 && this.shouldRegenerate(history)

      // ── 1. Generate or Rewrite ─────────────────────────────────────────
      let content: string
      if (round === 1 || needsRegenerate) {
        const ctx: GeneratorContext = { goal, history, round, isRegenerate: needsRegenerate, rubric }
        content = await this.generatorNode(ctx)
      } else {
        const prev = history[history.length - 1]!
        const ctx: RewriterContext = {
          content: prev.content,
          scoreReport: prev.scoreReport,
          goal,
          history,
          round,
          rubric,
        }
        content = await this.rewriterNode(ctx)
      }

      // ── 2. Score ───────────────────────────────────────────────────────
      const scorerCtx: ScorerContext = { content, goal, history, round, rubric }
      const scoreReport = await this.scorerNode(scorerCtx)

      // ── 3. Decide ──────────────────────────────────────────────────────
      const deciderCtx: DeciderContext = {
        content,
        scoreReport,
        goal,
        history,
        round,
        rubric,
        passThreshold,
        maxRounds: maxIterations,
      }
      const decision = await this.deciderNode(deciderCtx)

      const record: IterationRecord = { round, content, scoreReport, action: decision.action }
      history.push(record)

      // ── 4. Act on decision ─────────────────────────────────────────────
      if (decision.action === 'pass') return this.buildResult(history, true)

      if (decision.action === 'regenerate') {
        console.log(`[Decider] Round ${round}: Regenerate. Reason: ${decision.reason}`)
      }

      // ── 5. Stagnation check ────────────────────────────────────────────
      if (this.hasStagnated(history)) {
        console.log(`[Stagnation] Round ${round}: Score stagnated (<5% change for ${this.stagnationThreshold} rounds). Stopping.`)
        return this.buildResult(history, false)
      }
    }

    return this.buildResult(history, false)
  }

  private shouldRegenerate(history: IterationRecord[]): boolean {
    if (history.length < 1) return false
    return history[history.length - 1]!.action === 'regenerate'
  }

  /**
   * Stagnation: consecutive N rounds with <5% delta between adjacent scores.
   */
  private hasStagnated(history: IterationRecord[]): boolean {
    if (history.length < this.stagnationThreshold + 1) return false
    const recent = history.slice(-this.stagnationThreshold)
    const scores = recent.map(h => h.scoreReport.totalScore)
    for (let i = 1; i < scores.length; i++) {
      if (Math.abs(scores[i] - scores[i - 1]) >= 0.05) return false
    }
    return true
  }

  private buildResult(history: IterationRecord[], passed: boolean): AutoResearchResult {
    const last = history[history.length - 1]!
    return {
      content: last.content,
      score: last.scoreReport,
      iterations: history.length,
      passed,
      history: [...history],
    }
  }
}

