/**
 * @fileoverview Build user prompt for each phase.
 *
 * 替代 workflow/coding_pipline/pipeline.ts 里硬编码的 prompt 拼装逻辑。
 */

import type { Payload } from 'payload'
import type { PhaseName } from '../types'

export interface BuildPromptInput {
  payload: Payload
  phaseId: string
  phaseName: PhaseName
  /** Resolved requirement text for this outer loop */
  requirement: string
  /** Path to openspec change directory (already rendered to disk) */
  changeDir: string
  /** Project working directory */
  projectDir: string
}

export async function buildUserPrompt(input: BuildPromptInput): Promise<string> {
  // TODO(S3+): 按 phase 拼装与 V3 等价的 user prompt。
  // 现阶段返回最小占位，让 S3 端到端先通起来。
  switch (input.phaseName) {
    case 'plan':
      return `Fill in the OpenSpec change at ${input.changeDir}.\n\nRequirement:\n${input.requirement}`
    case 'code':
      return `Implement the tasks in ${input.changeDir}/tasks.md following the design.\n\nRequirement:\n${input.requirement}`
    case 'test':
      return `Verify the implementation against ${input.changeDir}/specs/*.md using BDD scenarios.`
    case 'reflect':
      return `As PM, judge whether the requirement is satisfied. Output ACCEPTED or REVISE: <new requirement>.\n\nRequirement:\n${input.requirement}`
    default:
      return ''
  }
}

/** Tester 用的 Ralph completion promise（必须与 TESTER prompt 中的 <promise>...</promise> 一致） */
export const TESTER_COMPLETION_PROMISE = 'all-bdd-scenarios-pass'

/** Coder 用的 completion 标记（V3 单次执行，但 prompt 中也带此标记便于校验） */
export const CODER_COMPLETION_PROMISE = 'CODING_COMPLETE'
