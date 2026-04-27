/**
 * @fileoverview Ralph Loop 集成
 *
 * Ralph Wiggum 是一种通过持续迭代实现任务完成的方法：
 *   "while not done: feed the same prompt back"
 *
 * 原生 Ralph 使用 Stop hook 脚本拦截 claude-code 的交互式退出。
 * 在我们的 SDK 编程模式中，我们直接控制循环——语义完全等价，但更可靠。
 *
 * 参考：https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 */

import { ClaudeAgent } from '../core/agent/claude-agent.js'
import type { ClaudeAgentOptions } from '../core/agent/claude-agent.js'
import type { AgentLogEvent } from '../core/agent/claude-agent.js'
import type { RalphState, RalphRunResult } from './types.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Ralph 状态文件（与原生 ralph-loop.local.md 格式兼容）
// ---------------------------------------------------------------------------

const RALPH_STATE_FILENAME = 'ralph-loop.local.md'

/**
 * 写入 Ralph 状态文件到 projectDir/.claude/
 * 格式与原生 Ralph 插件兼容，方便调试时用 /ralph-loop 查看状态
 */
export function writeRalphState(projectDir: string, state: RalphState): void {
  const claudeDir = path.join(projectDir, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  const stateFile = path.join(claudeDir, RALPH_STATE_FILENAME)
  const content = [
    '---',
    `iteration: ${state.iteration}`,
    `max_iterations: ${state.maxIterations}`,
    `completion_promise: "${state.completionPromise}"`,
    '---',
    '',
    state.prompt,
  ].join('\n')
  fs.writeFileSync(stateFile, content, 'utf8')
}

/** 清理 Ralph 状态文件 */
export function clearRalphState(projectDir: string): void {
  const stateFile = path.join(projectDir, '.claude', RALPH_STATE_FILENAME)
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile)
}

/**
 * 检查输出中是否包含 completion promise
 * 同时支持 <promise>TEXT</promise> 格式和纯文本格式
 */
export function hasCompletionPromise(output: string, completionPromise: string): boolean {
  // <promise>SIGNAL</promise> 格式（原生 Ralph 格式）
  const tagMatch = output.match(/<promise>([\s\S]*?)<\/promise>/)
  if (tagMatch && tagMatch[1].trim() === completionPromise.trim()) return true
  // 纯文本包含
  return output.includes(completionPromise)
}

// ---------------------------------------------------------------------------
// Ralph Loop 核心
// ---------------------------------------------------------------------------

export interface RalphAgentOptions extends Omit<ClaudeAgentOptions, 'systemPrompt' | 'cwd' | 'maxTurns'> {
  /** Agent 系统提示词 */
  systemPrompt: string
  /** 项目目录（也是 Agent 的 cwd） */
  projectDir: string
  /** 每次迭代的最大 turns（默认 60） */
  turnsPerIteration?: number
  /** 进度日志回调 */
  onLog?: (msg: string) => void
}

/**
 * 以 Ralph Loop 模式运行 ClaudeAgent
 *
 * 每次迭代：
 *   1. 运行 agent.run(prompt)
 *   2. 检测输出中是否含 completionPromise
 *   3. 是 → 退出循环；否且未超上限 → 继续下一轮
 *
 * 与原生 Ralph 的行为完全等价：
 *   - 同一个 prompt 每轮保持不变
 *   - Agent 的文件变动在轮次间自然累积（git + 文件系统）
 *   - 每轮 Agent 都能读取前几轮写入的文件
 */
export async function runWithRalph(
  agentName: string,
  prompt: string,
  state: Pick<RalphState, 'completionPromise' | 'maxIterations'>,
  opts: RalphAgentOptions,
): Promise<RalphRunResult> {
  const { projectDir, systemPrompt, turnsPerIteration = 60, onLog, ...agentOpts } = opts
  const log = onLog ?? ((msg: string) => console.log(msg))

  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  let lastOutput = ''
  let completedIter = 0

  const maxIter = state.maxIterations > 0 ? state.maxIterations : Infinity

  for (let i = 1; i <= maxIter; i++) {
    completedIter = i
    log(`[Ralph:${agentName}] iteration ${i}/${state.maxIterations || '∞'}`)

    // Update state file (for compatibility / debugging)
    writeRalphState(projectDir, {
      prompt,
      iteration: i,
      maxIterations: state.maxIterations,
      completionPromise: state.completionPromise,
    })

    let iterCostUsd = 0
    const { model, onEvent: userOnEvent, ...restOpts } = agentOpts
    const trackingOnEvent = (event: AgentLogEvent) => {
      if (event.type === 'result') {
        iterCostUsd += ((event.data as Record<string, unknown>).cost_usd as number) ?? 0
      }
      userOnEvent?.(event)
    }

    const agent = new ClaudeAgent(
      { name: agentName, model: model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6' },
      { systemPrompt, cwd: projectDir, maxTurns: turnsPerIteration, onEvent: trackingOnEvent, ...restOpts },
    )

    const result = await agent.run(prompt)
    lastOutput = result.output
    totalInput += result.tokenUsage.input_tokens
    totalOutput += result.tokenUsage.output_tokens
    totalCost += iterCostUsd

    log(`[Ralph:${agentName}] iter ${i} done — ${result.output.slice(0, 120).replace(/\n/g, ' ')}`)

    if (hasCompletionPromise(result.output, state.completionPromise)) {
      log(`[Ralph:${agentName}] ✓ completion promise detected after ${i} iteration(s)`)
      clearRalphState(projectDir)
      return {
        output: lastOutput,
        completed: true,
        iterations: completedIter,
        tokenUsage: { input: totalInput, output: totalOutput },
        costUsd: totalCost,
      }
    }

    log(`[Ralph:${agentName}] completion promise not found — continuing...`)
  }

  // Max iterations reached
  log(`[Ralph:${agentName}] ⚠ max iterations (${state.maxIterations}) reached without completion`)
  clearRalphState(projectDir)
  return {
    output: lastOutput,
    completed: false,
    iterations: completedIter,
    tokenUsage: { input: totalInput, output: totalOutput },
    costUsd: totalCost,
  }
}

// ---------------------------------------------------------------------------
// Stop Hook 脚本（原生 Ralph 兼容，供本地交互式使用参考）
// ---------------------------------------------------------------------------

/**
 * 将原生 Ralph stop hook 脚本安装到 projectDir/.claude/hooks/
 * 仅在需要交互式 /ralph-loop 支持时调用。
 * 程序化 runWithRalph() 不需要此脚本。
 */
export function installRalphStopHook(projectDir: string): void {
  const hooksDir = path.join(projectDir, '.claude', 'hooks')
  fs.mkdirSync(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, 'ralph-stop-hook.sh')
  if (!fs.existsSync(hookPath)) {
    fs.writeFileSync(hookPath, RALPH_STOP_HOOK_SCRIPT, { mode: 0o755 })
  }
}

/**
 * 原生 Ralph stop hook 脚本内容
 * 来源：https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 */
const RALPH_STOP_HOOK_SCRIPT = `#!/bin/bash
# Ralph Wiggum Stop Hook — blocks Claude Code exit and re-feeds the prompt
# Source: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
set -euo pipefail

HOOK_INPUT=$(cat)
RALPH_STATE_FILE=".claude/ralph-loop.local.md"

if [[ ! -f "$RALPH_STATE_FILE" ]]; then exit 0; fi

FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$RALPH_STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//')
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//')
COMPLETION_PROMISE=$(echo "$FRONTMATTER" | grep '^completion_promise:' | sed 's/completion_promise: *//' | sed 's/^"\\(.*\\)"$/\\1/')

if [[ ! "$ITERATION" =~ ^[0-9]+$ ]] || [[ ! "$MAX_ITERATIONS" =~ ^[0-9]+$ ]]; then
  rm "$RALPH_STATE_FILE"; exit 0
fi

if [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  echo "Ralph loop: Max iterations ($MAX_ITERATIONS) reached."
  rm "$RALPH_STATE_FILE"; exit 0
fi

TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')
if [[ ! -f "$TRANSCRIPT_PATH" ]]; then rm "$RALPH_STATE_FILE"; exit 0; fi

LAST_OUTPUT=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -1 | jq -r '.message.content | map(select(.type=="text")) | map(.text) | join("\\n")' 2>/dev/null || echo "")

if [[ -n "$COMPLETION_PROMISE" ]] && [[ "$COMPLETION_PROMISE" != "null" ]]; then
  PROMISE_TEXT=$(echo "$LAST_OUTPUT" | perl -0777 -pe 's/.*?<promise>(.*?)<\\/promise>.*/$1/s; s/^\\s+|\\s+$//g; s/\\s+/ /g' 2>/dev/null || echo "")
  if [[ -n "$PROMISE_TEXT" ]] && [[ "$PROMISE_TEXT" = "$COMPLETION_PROMISE" ]]; then
    echo "Ralph loop: Detected <promise>$COMPLETION_PROMISE</promise>"
    rm "$RALPH_STATE_FILE"; exit 0
  fi
fi

NEXT_ITERATION=$((ITERATION + 1))
PROMPT_TEXT=$(awk '/^---$/{i++; next} i>=2' "$RALPH_STATE_FILE")
sed -i.bak "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$RALPH_STATE_FILE" && rm -f "\${RALPH_STATE_FILE}.bak"

echo "$PROMPT_TEXT"
`
