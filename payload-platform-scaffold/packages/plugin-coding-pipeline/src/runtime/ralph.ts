/**
 * @fileoverview Ralph Loop（Tester 专用）— in-job 版本
 *
 * 决策：单个 job 内部循环（重启 = 重跑该 phase）。
 * 与 workflow/coding_pipline/ralph.ts 等价，但每轮都落库 ralphIterations。
 */

import type { Payload } from 'payload'
import { runAgent, type RunAgentInput, type RunAgentResult } from './claudeBridge'

export interface RalphLoopInput extends Omit<RunAgentInput, 'ralphIterationId'> {
  completionPromise: string
  maxIterations: number
}

export interface RalphLoopResult extends RunAgentResult {
  iterations: number
  completed: boolean
}

export async function runRalphLoop(input: RalphLoopInput): Promise<RalphLoopResult> {
  const { payload, phaseId, completionPromise, maxIterations, ...rest } = input
  let totalCost = 0
  let totalIn = 0
  let totalOut = 0
  let lastOutput = ''
  let i = 0

  for (i = 1; i <= maxIterations; i++) {
    const iterDoc = await payload.create({
      collection: 'pipeline-ralph-iterations',
      data: { phase: phaseId, iteration: i, prompt: rest.prompt },
    })

    const r = await runAgent({
      ...rest,
      payload,
      phaseId,
      ralphIterationId: iterDoc.id as string,
    })

    totalCost += r.costUsd
    totalIn += r.tokensIn
    totalOut += r.tokensOut
    lastOutput = r.output

    const done = hasCompletionPromise(r.output, completionPromise)

    await payload.update({
      collection: 'pipeline-ralph-iterations',
      id: iterDoc.id,
      data: {
        output: r.output,
        completionDetected: done,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        costUsd: r.costUsd,
      },
    })

    if (done) {
      return { output: lastOutput, costUsd: totalCost, tokensIn: totalIn, tokensOut: totalOut,
        iterations: i, completed: true }
    }
  }

  return { output: lastOutput, costUsd: totalCost, tokensIn: totalIn, tokensOut: totalOut,
    iterations: i - 1, completed: false }
}

function hasCompletionPromise(output: string, promise: string): boolean {
  const tag = output.match(/<promise>([\s\S]*?)<\/promise>/)
  if (tag && tag[1].trim() === promise.trim()) return true
  return output.includes(promise)
}
