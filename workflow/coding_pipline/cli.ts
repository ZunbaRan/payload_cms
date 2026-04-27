#!/usr/bin/env node
/**
 * Pipeline V3 CLI 入口
 *
 * 用法：
 *   npx tsx src/pipeline-v3/cli.ts --project /path/to/repo --requirement "实现用户登录"
 *   npx tsx src/pipeline-v3/cli.ts --project /path/to/repo --requirement-file ./req.txt
 *   echo "实现用户登录" | npx tsx src/pipeline-v3/cli.ts --project /path/to/repo
 *
 * 退出码：
 *   0 — pipeline 成功（Reflector ACCEPTED）
 *   1 — pipeline 失败或出错
 *   2 — 参数错误
 */

import { parseArgs } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { PipelineV3 } from './pipeline.js'
import type { V3ProgressEvent } from './types.js'
import type { AgentLogEvent } from '../core/agent/claude-agent.js'

// ── 参数解析 ────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    project:           { type: 'string',  short: 'p' },
    requirement:       { type: 'string',  short: 'r' },
    'requirement-file':{ type: 'string',  short: 'f' },
    'claude-md':       { type: 'string' },
    'max-loops':       { type: 'string' },
    'ralph-iterations':{ type: 'string' },
    model:             { type: 'string' },
    'log-file':        { type: 'string' },
    'log-dir':         { type: 'string' },
    verbose:           { type: 'boolean', short: 'v', default: false },
    quiet:             { type: 'boolean', short: 'q', default: false },
    help:              { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
})

if (values.help) {
  console.log(`
Pipeline V3 — OpenSpec + Superpowers + BDD 自动编码流水线

用法：
  pipeline-v3 [选项]

选项：
  -p, --project <path>           目标 git 仓库路径（必填）
  -r, --requirement <text>       需求文本（与 --requirement-file / stdin 三选一）
  -f, --requirement-file <path>  从文件读取需求
      --claude-md <path>         CLAUDE.md 文件路径（项目背景信息）
      --max-loops <n>            最大外层循环次数（默认 3）
      --ralph-iterations <n>     Tester 最大迭代次数（默认 20）
      --model <name>             模型名称（默认使用 DEFAULT_MODEL 环境变量）
      --log-file <path>          日志文件路径（默认在项目目录下自动生成）
      --log-dir <path>           日志文件输出目录（默认：项目目录）
  -v, --verbose                  在终端同时打印工具调用和 Agent 思考过程
  -q, --quiet                    只输出最终结果，不显示进度（日志文件仍会写入）
  -h, --help                     显示帮助

环境变量：
  ANTHROPIC_API_KEY              API 密钥
  ANTHROPIC_BASE_URL             自定义 API 地址（代理/私有部署）
  DEFAULT_MODEL                  默认模型名称
  FLASH_BASE_URL / FLASH_MODEL   快速模型配置（Memory Agent 使用）

示例：
  # 直接传需求（自动生成日志文件）
  pipeline-v3 --project /srv/my-app --requirement "实现用户注册接口"

  # 详细模式：终端显示每个工具调用
  pipeline-v3 --project /srv/my-app -r "..." --verbose

  # 自定义日志路径
  pipeline-v3 --project /srv/my-app -r "..." --log-file ./run.log

  # 从文件读取
  pipeline-v3 --project /srv/my-app --requirement-file ./feature.txt

  # 指定 CLAUDE.md 提供项目背景
  pipeline-v3 --project /srv/my-app -r "..." --claude-md ./CLAUDE.md
`)
  process.exit(0)
}

// ── 读取需求 ─────────────────────────────────────────────────────────────────

async function readRequirement(): Promise<string> {
  // 1. 直接参数
  if (values.requirement) return values.requirement as string

  // 2. 文件
  if (values['requirement-file']) {
    const fp = path.resolve(values['requirement-file'] as string)
    if (!fs.existsSync(fp)) fatal(`需求文件不存在: ${fp}`)
    return fs.readFileSync(fp, 'utf8').trim()
  }

  // 3. positional arg (第一个非选项参数)
  if (positionals.length > 0) return positionals.join(' ').trim()

  // 4. stdin (非 TTY 时读取管道内容)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: process.stdin })
      const lines: string[] = []
      rl.on('line', line => lines.push(line))
      rl.on('close', () => resolve(lines.join('\n').trim()))
      rl.on('error', reject)
    })
  }

  fatal('请通过 --requirement、--requirement-file 或 stdin 提供需求内容')
  return '' // unreachable
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function fatal(msg: string): never {
  console.error(`\n❌  ${msg}\n`)
  console.error('运行 pipeline-v3 --help 查看帮助')
  process.exit(2)
}

function dim(s: string) { return `\x1b[2m${s}\x1b[0m` }
function bold(s: string) { return `\x1b[1m${s}\x1b[0m` }
function green(s: string) { return `\x1b[32m${s}\x1b[0m` }
function red(s: string)   { return `\x1b[31m${s}\x1b[0m` }
function cyan(s: string)  { return `\x1b[36m${s}\x1b[0m` }
function yellow(s: string){ return `\x1b[33m${s}\x1b[0m` }
function gray(s: string)  { return `\x1b[90m${s}\x1b[0m` }

const PHASE_ICONS: Record<string, string> = {
  prepare: '🔧',
  plan:    '📐',
  code:    '💻',
  test:    '🧪',
  reflect: '🪞',
  memory:  '🧠',
  complete:'✅',
}

// ── PipelineLogger ────────────────────────────────────────────────────────────
//
// 将 Pipeline 运行的所有事件写入结构化日志文件，方便事后分析 Agent 决策过程。
// 日志采用纯文本格式，每个 Phase 有清晰的分隔，包含：
//   - Phase 开始/完成时间戳与耗时
//   - 每个 Agent 的工具调用（名称 + 简要输入）
//   - Agent 思考文本（前 500 字）
//   - 工具返回结果摘要
//   - 每次运行的 Token 消耗与费用
// ---------------------------------------------------------------------------

/** 格式化工具输入为单行简洁字符串 */
function formatToolInput(toolName: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return String(input).slice(0, 120)
  const inp = input as Record<string, unknown>

  // 常见工具的特化格式
  switch (toolName) {
    case 'Read':
    case 'ReadFile':
      return String(inp.file_path ?? inp.path ?? '').slice(0, 120)
    case 'Write':
    case 'WriteFile':
      return `${String(inp.file_path ?? inp.path ?? '').slice(0, 80)} (${String(inp.content ?? '').length} chars)`
    case 'Edit':
    case 'MultiEdit':
      return String(inp.file_path ?? inp.path ?? '').slice(0, 80)
    case 'Bash':
      return String(inp.command ?? '').slice(0, 120).replace(/\n/g, '↵')
    case 'Glob':
      return String(inp.pattern ?? '').slice(0, 80)
    case 'Grep':
      return `"${String(inp.pattern ?? '').slice(0, 60)}" in ${String(inp.path ?? '.').slice(0, 40)}`
    case 'TodoRead':
    case 'TodoWrite':
      return toolName === 'TodoWrite' ? `${(inp.todos as unknown[])?.length ?? 0} todos` : ''
    default: {
      const s = JSON.stringify(input)
      return s.length > 120 ? s.slice(0, 117) + '...' : s
    }
  }
}

class PipelineLogger {
  private phaseStartMs = 0
  private currentPhase = ''

  constructor(readonly logPath: string) {
    const dir = path.dirname(logPath)
    if (dir) fs.mkdirSync(dir, { recursive: true })
    // Overwrite on new run
    fs.writeFileSync(logPath, '', 'utf8')
  }

  private write(s: string): void {
    try { fs.appendFileSync(this.logPath, s + '\n', 'utf8') } catch { /* ignore */ }
  }

  private ts(): string {
    return new Date().toISOString()
  }

  /** 写入 Pipeline 运行元信息头部 */
  writeHeader(opts: { projectDir: string; requirement: string; model: string; maxOuterLoops: number; ralphMaxIterations: number }) {
    this.write('═'.repeat(80))
    this.write(`Pipeline V3 Run — ${this.ts()}`)
    this.write('═'.repeat(80))
    this.write(`Project:          ${opts.projectDir}`)
    this.write(`Model:            ${opts.model}`)
    this.write(`Max Outer Loops:  ${opts.maxOuterLoops}`)
    this.write(`Ralph Iterations: ${opts.ralphMaxIterations}`)
    this.write(`Requirement:`)
    for (const line of opts.requirement.split('\n')) this.write(`  ${line}`)
    this.write('')
  }

  /** 处理来自 pipeline.onProgress 的事件 */
  handleEvent(event: V3ProgressEvent): void {
    const phase = event.phase.toUpperCase()
    const iter = event.iteration !== undefined ? ` [loop ${event.iteration}]` : ''

    if (event.status === 'start') {
      this.phaseStartMs = Date.now()
      this.currentPhase = event.phase
      this.write('')
      this.write('─'.repeat(80))
      this.write(`▶ PHASE: ${phase}${iter}  —  ${this.ts()}`)
      this.write(`  ${event.message}`)
      this.write('─'.repeat(80))
      return
    }

    if (event.status === 'complete' || event.status === 'error') {
      const elapsed = this.phaseStartMs ? `${((Date.now() - this.phaseStartMs) / 1000).toFixed(1)}s` : '?s'
      const mark = event.status === 'complete' ? '✓' : '✗'
      this.write(`${mark} ${phase}${iter} DONE  [${elapsed}]  —  ${this.ts()}`)
      this.write(`  ${event.message}`)
      return
    }

    // progress events carry the raw AgentLogEvent
    if (event.status === 'progress' && event.data?.event) {
      this.handleAgentEvent(event.data.event as AgentLogEvent)
    }
  }

  private handleAgentEvent(e: AgentLogEvent): void {
    const prefix = `  [${e.agentName}]`

    switch (e.type) {
      case 'system_init':
        this.write(`${prefix} INIT — model: ${e.data.model}  session: ${e.data.session_id}`)
        if (Array.isArray(e.data.tools) && e.data.tools.length) {
          this.write(`${prefix}   tools: ${(e.data.tools as string[]).join(', ')}`)
        }
        if (Array.isArray(e.data.skills) && (e.data.skills as string[]).length) {
          this.write(`${prefix}   skills: ${(e.data.skills as string[]).join(', ')}`)
        }
        break

      case 'assistant_text': {
        const text = String(e.data.text ?? '')
        // Only log meaningful text blocks (skip very short ones)
        if (text.trim().length < 10) break
        this.write(`${prefix} THINKING:`)
        const preview = text.length > 800 ? text.slice(0, 800) + '\n    [...truncated]' : text
        for (const line of preview.split('\n')) {
          this.write(`    ${line}`)
        }
        break
      }

      case 'tool_call': {
        const toolName = String(e.data.tool_name ?? 'unknown')
        const inputSummary = formatToolInput(toolName, e.data.input)
        this.write(`${prefix} CALL  ${toolName}(${inputSummary})`)
        break
      }

      case 'tool_result': {
        const result = String(e.data.result ?? '').trim()
        const preview = result.length > 300 ? result.slice(0, 300) + '...' : result
        if (preview) {
          this.write(`${prefix} RESULT →`)
          for (const line of preview.split('\n').slice(0, 10)) {
            this.write(`    ${line}`)
          }
        }
        break
      }

      case 'tool_progress':
        // Only log slow tools (> 5s)
        if (Number(e.data.elapsed_seconds ?? 0) > 5) {
          this.write(`${prefix} PROGRESS  ${e.data.tool_name} (${e.data.elapsed_seconds}s)`)
        }
        break

      case 'result':
        this.write(
          `${prefix} RUN_COMPLETE — turns: ${e.data.num_turns}  cost: $${Number(e.data.cost_usd ?? 0).toFixed(4)}` +
          `  tokens: ${e.data.input_tokens}in/${e.data.output_tokens}out  duration: ${Math.round(Number(e.data.duration_ms ?? 0) / 1000)}s`
        )
        break
    }
  }

  writeFooter(result: {
    success: boolean
    outerLoops: number
    featureBranch: string
    totalCostUsd: number
    tokenUsage: { input: number; output: number }
    reflectorOutput: string
  }) {
    this.write('')
    this.write('═'.repeat(80))
    this.write(`Pipeline V3 Result — ${this.ts()}`)
    this.write('═'.repeat(80))
    this.write(`Status:         ${result.success ? 'ACCEPTED ✓' : 'NOT ACCEPTED ✗'}`)
    this.write(`Outer Loops:    ${result.outerLoops}`)
    this.write(`Feature Branch: ${result.featureBranch}`)
    this.write(`Total Cost:     $${result.totalCostUsd.toFixed(4)}`)
    this.write(`Total Tokens:   ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`)
    this.write('')
    this.write('Reflector Output:')
    for (const line of result.reflectorOutput.split('\n')) this.write(`  ${line}`)
    this.write('')
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate --project
  const projectDir = values.project ? path.resolve(values.project as string) : undefined
  if (!projectDir) fatal('请通过 --project 指定目标 git 仓库路径')
  if (!fs.existsSync(projectDir)) fatal(`项目目录不存在: ${projectDir}`)
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    fatal(`${projectDir} 不是一个 git 仓库（缺少 .git 目录）`)
  }

  const requirement = await readRequirement()
  if (!requirement) fatal('需求内容不能为空')

  // Optional CLAUDE.md
  let claudeMd: string | undefined
  if (values['claude-md']) {
    const p = path.resolve(values['claude-md'] as string)
    if (!fs.existsSync(p)) fatal(`CLAUDE.md 文件不存在: ${p}`)
    claudeMd = fs.readFileSync(p, 'utf8')
  }

  const maxOuterLoops = values['max-loops'] ? parseInt(values['max-loops'] as string, 10) : 3
  const ralphMaxIterations = values['ralph-iterations'] ? parseInt(values['ralph-iterations'] as string, 10) : 20
  const quiet = values.quiet as boolean
  const verbose = values.verbose as boolean
  const modelName = (values.model as string | undefined) ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6'

  // ── Log file setup ────────────────────────────────────────────────────────
  let logPath: string
  if (values['log-file']) {
    logPath = path.resolve(values['log-file'] as string)
  } else {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const logDir = values['log-dir'] ? path.resolve(values['log-dir'] as string) : projectDir
    logPath = path.join(logDir, `pipeline-v3-${ts}.log`)
  }

  const logger = new PipelineLogger(logPath)
  logger.writeHeader({ projectDir, requirement, model: modelName, maxOuterLoops, ralphMaxIterations })

  // ── Header ──────────────────────────────────────────────────────────────
  if (!quiet) {
    console.log(bold('\n┌─ Pipeline V3 ────────────────────────────────────────────┐'))
    console.log(`│ 项目: ${dim(projectDir)}`)
    console.log(`│ 需求: ${requirement.slice(0, 80)}${requirement.length > 80 ? '…' : ''}`)
    console.log(`│ 最大循环: ${maxOuterLoops}  Tester 迭代: ${ralphMaxIterations}`)
    console.log(`│ 日志:  ${cyan(logPath)}`)
    console.log(bold('└──────────────────────────────────────────────────────────┘\n'))
  }

  let lastPhase = ''
  let dotCount = 0

  const flushDots = () => {
    if (dotCount > 0) { process.stdout.write('\n'); dotCount = 0 }
  }

  // ── Run pipeline ─────────────────────────────────────────────────────────
  const pipeline = new PipelineV3({
    projectDir,
    requirement,
    claudeMd,
    maxOuterLoops,
    ralphMaxIterations,
    model: modelName,
    onProgress: (event: V3ProgressEvent) => {
      // Always write to log file
      logger.handleEvent(event)

      if (quiet) return

      const icon = PHASE_ICONS[event.phase] ?? '•'

      if (event.status !== 'progress') {
        // Phase start / complete / error — always print to terminal
        if (event.phase !== lastPhase) {
          flushDots()
          lastPhase = event.phase
        } else {
          flushDots()
        }
        const iter = event.iteration !== undefined ? dim(` [loop ${event.iteration}]`) : ''
        const tag = event.status === 'complete' ? green('✓') : event.status === 'error' ? red('✗') : cyan('→')
        console.log(`${icon}  ${tag} ${bold(event.phase)}${iter}  ${dim(event.message)}`)
        return
      }

      // progress events
      if (!verbose) {
        // Non-verbose: show dots (one per event)
        process.stdout.write('.')
        dotCount++
        if (dotCount % 80 === 0) { process.stdout.write('\n'); dotCount = 0 }
        return
      }

      // Verbose mode: print meaningful progress events inline
      const agentEvent = event.data?.event as AgentLogEvent | undefined
      if (!agentEvent) return

      switch (agentEvent.type) {
        case 'tool_call': {
          flushDots()
          const toolName = String(agentEvent.data.tool_name ?? 'unknown')
          const inputSummary = formatToolInput(toolName, agentEvent.data.input)
          console.log(gray(`   [${agentEvent.agentName}] 🔧 ${toolName}(${inputSummary.slice(0, 100)})`))
          break
        }
        case 'assistant_text': {
          const text = String(agentEvent.data.text ?? '').trim()
          if (text.length > 20) {
            flushDots()
            const preview = text.replace(/\n+/g, ' ').slice(0, 120)
            console.log(gray(`   [${agentEvent.agentName}] 💭 ${preview}${text.length > 120 ? '…' : ''}`))
          }
          break
        }
        case 'result': {
          flushDots()
          console.log(dim(`   [${agentEvent.agentName}] cost: $${Number(agentEvent.data.cost_usd ?? 0).toFixed(4)}  tokens: ${agentEvent.data.input_tokens}in/${agentEvent.data.output_tokens}out`))
          break
        }
        default:
          // Swallow other event types in verbose mode (already in log)
      }
    },
  })

  let result
  try {
    result = await pipeline.run()
  } catch (err) {
    flushDots()
    console.error(red(`\n❌ Pipeline 运行出错: ${err}`))
    if (err instanceof Error) console.error(dim(err.stack ?? ''))
    process.exit(1)
  }

  // ── Result ───────────────────────────────────────────────────────────────
  logger.writeFooter(result)

  if (!quiet) {
    console.log(bold('\n┌─ 运行结果 ────────────────────────────────────────────────┐'))
    console.log(`│ 状态:        ${result.success ? green('ACCEPTED ✓') : red('未通过')}`)
    console.log(`│ 外层循环:    ${result.outerLoops}`)
    console.log(`│ Feature 分支: ${cyan(result.featureBranch)}`)
    console.log(`│ 总费用:      $${result.totalCostUsd.toFixed(4)}`)
    console.log(`│ Token 用量:  ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`)
    if (result.reflectorOutput) {
      const preview = result.reflectorOutput.replace(/\n/g, ' ').slice(0, 120)
      console.log(`│ Reflector:   ${dim(preview)}`)
    }
    console.log(`│ 日志文件:    ${cyan(logPath)}`)
    console.log(bold('└──────────────────────────────────────────────────────────┘\n'))
  } else {
    // quiet 模式：只输出 JSON 供脚本解析
    console.log(JSON.stringify({
      success: result.success,
      featureBranch: result.featureBranch,
      outerLoops: result.outerLoops,
      totalCostUsd: result.totalCostUsd,
      logFile: logPath,
      reflectorOutput: result.reflectorOutput.slice(0, 500),
    }))
  }

  process.exit(result.success ? 0 : 1)
}

main()
