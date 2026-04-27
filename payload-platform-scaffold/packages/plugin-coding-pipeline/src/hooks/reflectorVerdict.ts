/**
 * @fileoverview 解析 Reflector 输出，写 outerLoops.verdict
 *
 * 等价于 workflow/coding_pipline/pipeline.ts#parseReflectorDecision。
 * 实际"是否进入下一轮 / 归档"在 OuterLoops.afterChange hook 里处理。
 */

import type { Payload } from 'payload'

export interface ReflectorVerdictInput {
  payload: Payload
  outerLoopId: string
  reflectorOutput: string
}

export async function applyReflectorVerdict(input: ReflectorVerdictInput): Promise<{
  verdict: 'accepted' | 'revise'
  newRequirement?: string
}> {
  const { payload, outerLoopId, reflectorOutput } = input
  const upper = reflectorOutput.toUpperCase()

  let verdict: 'accepted' | 'revise'
  let newRequirement: string | undefined

  if (upper.includes('ACCEPTED')) {
    verdict = 'accepted'
  } else {
    verdict = 'revise'
    const m = reflectorOutput.match(/REVISE:\s*([\s\S]+)/i)
    newRequirement = (m ? m[1] : reflectorOutput).trim()
  }

  await payload.update({
    collection: 'pipeline-outer-loops',
    id: outerLoopId,
    data: {
      verdict,
      reflectorOutput,
      status: 'awaiting-review', // 等人工 override 或自动放行
    },
  })

  return { verdict, newRequirement }
}
