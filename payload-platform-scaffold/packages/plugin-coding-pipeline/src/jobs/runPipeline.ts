/**
 * @fileoverview Job: runPipeline
 *
 * 触发：Run.afterChange 当 status 变为 'queued' 时入队。
 *
 * 职责：
 *   1. 创建 OuterLoop[0] + OpenSpec change + 5 个 Phase
 *   2. 把 prepare phase 入队
 *   3. Run.status → running
 */

import type { TaskHandler } from 'payload'
import { spawnOuterLoop, sanitizeChangeName } from '../runtime/spawnOuterLoop'

export const runPipelineHandler: TaskHandler<'runPipeline'> = async ({ input, req }) => {
  const { runId } = input as { runId: string }
  const payload = req.payload

  const run = await payload.findByID({ collection: 'pipeline-runs', id: runId, depth: 2 })
  payload.logger.info(`[coding-pipeline] runPipeline start runId=${runId}`)

  const requirement: any = run.requirement
  const requirementText: string = requirement?.text ?? ''
  const requirementTitle: string = requirement?.title ?? 'change'

  const changeNameBase = sanitizeChangeName(requirementTitle)
  const { outerLoopId, phaseId } = await spawnOuterLoop({
    payload, runId, loopIndex: 0, requirementText, changeNameBase,
  })

  await payload.update({
    collection: 'pipeline-runs', id: runId,
    data: { status: 'running', startedAt: new Date() },
  })

  return { output: { changeName: changeNameBase, outerLoopId, phaseQueued: phaseId } }
}
