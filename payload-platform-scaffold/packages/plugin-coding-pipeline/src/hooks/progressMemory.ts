/**
 * @fileoverview 写入 MemorySnapshot — phase 结束后由 runPhase 调用
 *
 * 等价于 workflow/coding_pipline/memory.ts 的功能：
 *   - 维护 MEMORY.md §0 进度
 *   - 把当前内容入库为快照
 *
 * §0 的"当前阶段/已完成阶段"由本函数显式构造，不再走 Memory Agent。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Payload } from 'payload'
import type { PhaseName } from '../types'

export interface ProgressMemoryInput {
  payload: Payload
  runId: string
  phaseId: string
  outerLoop: number
  totalOuterLoops: number
  currentStage: PhaseName | 'complete'
  completedStages: PhaseName[]
  changeName: string
  requirement: string
  projectDir: string
}

export async function progressMemory(input: ProgressMemoryInput): Promise<void> {
  const memoryPath = path.join(input.projectDir, 'MEMORY.md')
  let content = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : ''

  if (!content) {
    content = buildSkeleton(input)
  } else {
    content = updateSection0(content, input)
  }

  fs.writeFileSync(memoryPath, content, 'utf8')

  await input.payload.create({
    collection: 'pipeline-memory-snapshots',
    data: { run: input.runId, phase: input.phaseId, content },
  })
}

function buildSkeleton(i: ProgressMemoryInput): string {
  return `# MEMORY.md

---

## 0. Mission Overview

**原始需求**：
${i.requirement}

**当前进度**：
- 外层循环：第 ${i.outerLoop} 轮 / 最多 ${i.totalOuterLoops} 轮
- 当前阶段：${i.currentStage}
- 已完成阶段：[${i.completedStages.join(', ')}]
- 变更名称：${i.changeName}

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
}

function updateSection0(content: string, i: ProgressMemoryInput): string {
  return content
    .replace(/- 外层循环：第 \d+ 轮 \/ 最多 \d+ 轮/,
      `- 外层循环：第 ${i.outerLoop} 轮 / 最多 ${i.totalOuterLoops} 轮`)
    .replace(/- 当前阶段：.+/, `- 当前阶段：${i.currentStage}`)
    .replace(/- 已完成阶段：.*/, `- 已完成阶段：[${i.completedStages.join(', ')}]`)
    .replace(/- 变更名称：.*/, `- 变更名称：${i.changeName}`)
}
