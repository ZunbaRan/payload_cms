/**
 * @fileoverview Spawn an outer loop (used by both runPipeline and revise hook).
 *
 * 创建 OuterLoop + OpenSpec change + 5 个 Phase，并把 prepare 入队。
 */

import type { Payload } from 'payload'
import { PHASE_NAMES, PHASE_DEFAULT_ROLE } from '../types'

export interface SpawnOuterLoopInput {
  payload: Payload
  runId: string
  loopIndex: number
  requirementText: string
  /** 用于 OpenSpec change name；通常是 sanitized 的 title */
  changeNameBase: string
}

export interface SpawnOuterLoopResult {
  outerLoopId: string
  changeId: string
  phaseId: string
}

export async function spawnOuterLoop(input: SpawnOuterLoopInput): Promise<SpawnOuterLoopResult> {
  const { payload, runId, loopIndex, requirementText, changeNameBase } = input

  const outerLoop = await payload.create({
    collection: 'pipeline-outer-loops',
    data: { run: runId, loopIndex, requirementText, status: 'pending' },
  })

  // 后续 loop 加 -rN 后缀避免重名
  const changeName = loopIndex === 0 ? changeNameBase : `${changeNameBase}-r${loopIndex}`

  const change = await payload.create({
    collection: 'pipeline-openspec-changes',
    data: { run: runId, outerLoop: outerLoop.id, name: changeName },
  })

  let preparePhaseId: string | undefined
  for (let i = 0; i < PHASE_NAMES.length; i++) {
    const phaseName = PHASE_NAMES[i]
    const role = PHASE_DEFAULT_ROLE[phaseName]
    let agentRoleId: string | undefined
    if (role) {
      const found = await payload.find({
        collection: 'pipeline-agent-roles',
        where: { role: { equals: role } },
        limit: 1,
      })
      agentRoleId = found.docs[0]?.id as string | undefined
    }
    const phase = await payload.create({
      collection: 'pipeline-phases',
      data: {
        outerLoop: outerLoop.id,
        phaseName,
        order: i,
        agentRole: agentRoleId,
        status: 'pending',
      },
    })
    if (phaseName === 'prepare') preparePhaseId = phase.id as string
  }

  if (!preparePhaseId) throw new Error('prepare phase not created')
  await payload.jobs.queue({ task: 'runPhase', input: { phaseId: preparePhaseId } })

  return { outerLoopId: outerLoop.id as string, changeId: change.id as string, phaseId: preparePhaseId }
}

export function sanitizeChangeName(text: string): string {
  return (
    text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40)
        .replace(/-+$/, '') || 'change'
  )
}
