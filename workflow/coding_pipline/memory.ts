/**
 * @fileoverview Memory Agent 封装 (V3)
 *
 * V3 变化：
 * - MEMORY.md 改为 5-section 结构（§0 Mission Overview + §1-§4 动态）
 * - §0 由 pipeline orchestrator 写入并维护，Memory Agent 只读不改
 * - initMemory 写入完整骨架，updateSection0Progress 更新阶段进度
 */

import { ClaudeAgent } from '../core/agent/claude-agent.js'
import type { AgentLogEvent } from '../core/agent/claude-agent.js'
import { MEMORY_AGENT_SYSTEM_PROMPT } from './prompts.js'
import type { MemoryAgentInput } from './types.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// MEMORY.md 文件操作
// ---------------------------------------------------------------------------

const MEMORY_FILENAME = 'MEMORY.md'

/** 读取 MEMORY.md；若不存在返回空字符串 */
export function readMemory(projectDir: string): string {
  const memPath = path.join(projectDir, MEMORY_FILENAME)
  return fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : ''
}

/** 写入 MEMORY.md */
export function writeMemory(projectDir: string, content: string): void {
  fs.writeFileSync(path.join(projectDir, MEMORY_FILENAME), content, 'utf8')
}

/**
 * 初始化 MEMORY.md — 5-section 骨架
 * §0 由 pipeline 写入（不经过 Memory Agent）
 */
export function initMemory(
  projectDir: string,
  requirement: string,
  outerLoop: number,
  totalOuterLoops: number,
  changeName: string,
): void {
  const initial = `# MEMORY.md

---

## 0. Mission Overview

**原始需求**：
${requirement}

**成功标准**：
_由 Planner 在规划阶段确认_

**当前进度**：
- 外层循环：第 ${outerLoop} 轮 / 最多 ${totalOuterLoops} 轮
- 当前阶段：prepare
- 已完成阶段：[]
- 变更名称：${changeName}

---

## 1. Runtime Discoveries

_暂无_

---

## 2. Cross-Agent Handoff

_暂无_

---

## 3. Test Results Summary

_测试尚未运行_

---

## 4. Reflector Judgment

_反思尚未开始_
`
  writeMemory(projectDir, initial)
}

/**
 * 更新 §0 中的"当前进度"字段（pipeline orchestrator 调用）
 * 只修改进度相关的行，其他 §0 内容不变
 */
export function updateSection0Progress(
  projectDir: string,
  opts: {
    outerLoop: number
    totalOuterLoops: number
    currentStage: string
    completedStages: string[]
    changeName?: string
  },
): void {
  const memory = readMemory(projectDir)
  if (!memory) return

  let updated = memory

  // Update outer loop line
  updated = updated.replace(
    /- 外层循环：第 \d+ 轮 \/ 最多 \d+ 轮/,
    `- 外层循环：第 ${opts.outerLoop} 轮 / 最多 ${opts.totalOuterLoops} 轮`,
  )

  // Update current stage
  updated = updated.replace(
    /- 当前阶段：.+/,
    `- 当前阶段：${opts.currentStage}`,
  )

  // Update completed stages
  updated = updated.replace(
    /- 已完成阶段：.*/,
    `- 已完成阶段：[${opts.completedStages.join(', ')}]`,
  )

  // Update change name if provided
  if (opts.changeName) {
    updated = updated.replace(
      /- 变更名称：.*/,
      `- 变更名称：${opts.changeName}`,
    )
  }

  writeMemory(projectDir, updated)
}

// ---------------------------------------------------------------------------
// Git diff 工具
// ---------------------------------------------------------------------------

/**
 * 获取 git diff；截断到 8000 字符避免 prompt 过大
 */
export function getGitDiff(projectDir: string, sinceSha?: string): string {
  try {
    const args = sinceSha ? `diff ${sinceSha} HEAD` : 'diff HEAD'
    const result = execSync(`git ${args}`, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    })
    const trimmed = result.trim()
    if (!trimmed) return '(no changes)'
    if (trimmed.length > 8000) {
      return trimmed.slice(0, 8000) + '\n\n... [diff truncated]'
    }
    return trimmed
  } catch {
    return '(git diff unavailable)'
  }
}

/** 获取当前 HEAD sha */
export function getHeadSha(projectDir: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Memory Agent
// ---------------------------------------------------------------------------

/**
 * 从 Memory Agent 输出中提取 MEMORY.md 内容
 */
function extractMemoryContent(output: string): string {
  // 尝试解析 ```markdown ... ``` 包裹
  const fenced = output.match(/```(?:markdown)?\s*\n([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  // 寻找 # MEMORY.md 开头（V3）或 # Task Memory（V2 兼容）
  const headingMatch = output.match(/(# MEMORY\.md[\s\S]*)/)
  if (headingMatch) return headingMatch[1].trim()
  const legacyMatch = output.match(/(# Task Memory[\s\S]*)/)
  if (legacyMatch) return legacyMatch[1].trim()
  return output.trim()
}

/**
 * 运行 Memory Agent 并更新 MEMORY.md
 * §0 由 pipeline 维护，Memory Agent 被明确告知不修改它
 */
export async function runMemoryAgent(
  projectDir: string,
  input: MemoryAgentInput,
  opts?: Partial<{ model: string; onEvent: (event: AgentLogEvent) => void }>,
): Promise<void> {
  const userPrompt = buildMemoryPrompt(input)

  const defaultModel = process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6'
  const agent = new ClaudeAgent(
    { name: 'memory-agent', model: opts?.model ?? defaultModel },
    {
      systemPrompt: MEMORY_AGENT_SYSTEM_PROMPT,
      cwd: projectDir,
      maxTurns: 6,
      // Memory Agent 允许 Read/Write/Edit/Glob/Grep 以便直接读写 MEMORY.md。
      // 仅禁用可能造成副作用或跑偏的工具。
      disallowedTools: [
        'Bash', 'WebFetch', 'WebSearch',
        'Skill', 'Task', 'AskUserQuestion', 'NotebookEdit',
      ],
      injectNetworkRule: false,
      settingSources: [],
      onEvent: opts?.onEvent,
    },
  )

  const result = await agent.run(userPrompt)

  // 兼容两种写入模式：
  //  (A) Agent 使用 Write/Edit 直接写 MEMORY.md → 已落盘
  //  (B) Agent 在最终输出里给出完整 MEMORY.md 文本 → 解析后落盘
  const diskMemory = readMemory(projectDir)
  const outputMemory = extractMemoryContent(result.output)

  // 当前磁盘上的内容（Agent 若用 Write/Edit 已改过）
  let finalMemory = diskMemory

  // 若 Agent 没写盘、但把 MEMORY.md 作为文本输出，则兜底落盘
  if (outputMemory && outputMemory !== diskMemory) {
    writeMemory(projectDir, outputMemory)
    finalMemory = outputMemory
  }

  if (!finalMemory) return

  // §0 保护：始终用 buildMemoryPrompt 里传入的 input.section0Before 或当前 §0 覆盖
  // 这里以「调用前的 diskMemory 中的 §0」作为权威版本（pipeline 在调用前写好了 §0）
  const priorSection0 = diskMemory.match(/## 0\. Mission Overview([\s\S]*?)(?=---\n\n## 1\.|$)/)
  if (!priorSection0) return

  const currentSection0 = finalMemory.match(/## 0\. Mission Overview([\s\S]*?)(?=---\n\n## 1\.|$)/)
  if (!currentSection0 || currentSection0[1].trim() !== priorSection0[1].trim()) {
    const restored = finalMemory.replace(
      /## 0\. Mission Overview[\s\S]*?(?=---\n\n## 1\.)/,
      `## 0. Mission Overview${priorSection0[1]}`,
    )
    writeMemory(projectDir, restored)
  }
}

/**
 * 组装传给 Memory Agent 的完整 user prompt
 */
function buildMemoryPrompt(input: MemoryAgentInput): string {
  return `## Agent Role
${input.agentRole}

## Outer Loop
${input.outerLoop} of ${input.totalOuterLoops}

## Current Requirement
${input.requirement}

## Previous Agent Output
${input.agentOutput.slice(0, 4000)}${input.agentOutput.length > 4000 ? '\n\n... [truncated]' : ''}

## Git Changes Since Last Phase
\`\`\`diff
${input.gitDiff}
\`\`\`

## Current MEMORY.md
${input.currentMemory || '_Empty — this is the first update._'}

---

IMPORTANT: Do NOT modify ## 0. Mission Overview — copy it exactly as it appears above.
Output the full updated MEMORY.md now.
`
}
