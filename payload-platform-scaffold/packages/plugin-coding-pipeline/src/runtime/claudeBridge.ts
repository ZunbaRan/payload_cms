/**
 * @fileoverview Bridge to workflow/core ClaudeAgent.
 *
 * `workflow/core` 是独立项目，本 plugin 通过动态 import 调用，避免顶层耦合。
 * 路径来自 codingPipelinePlugin({ coreImportPath }) — 必须是绝对路径。
 *
 * 流程：
 *   1. create pipeline-agent-invocations row
 *   2. dynamic import ClaudeAgent
 *   3. new ClaudeAgent({name, model}, {systemPrompt, cwd, ..., onEvent: tracerSink})
 *   4. await agent.run(prompt)
 *   5. update invocation with output + tokens + cost + duration
 */

import type { Payload } from 'payload'
import { makeTracerSink } from './tracerSink'

let _coreImportPath: string | undefined

export function setCoreImportPath(p: string): void {
  _coreImportPath = p
}

export function getCoreImportPath(): string {
  const p = _coreImportPath ?? process.env.WORKFLOW_CORE_PATH
  if (!p) {
    throw new Error(
      '[coding-pipeline] coreImportPath not configured. Pass it to codingPipelinePlugin({coreImportPath}) or set WORKFLOW_CORE_PATH env.',
    )
  }
  return p
}

export interface RunAgentInput {
  payload: Payload
  phaseId: string
  ralphIterationId?: string
  systemPrompt: string
  prompt: string
  agentName: string
  model: string
  cwd: string
  maxTurns?: number
  maxBudgetUsd?: number
  permissionMode?: 'default' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'auto'
  allowedTools?: string[]
  env?: Record<string, string>
}

export interface RunAgentResult {
  output: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  sessionId?: string
  budgetExceeded?: boolean
  loopDetected?: boolean
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { payload } = input
  const startedAt = new Date()

  const modelDocs = await payload.find({
    collection: 'pipeline-models',
    where: { name: { equals: input.model } },
    limit: 1,
  })
  const modelId = modelDocs.docs[0]?.id

  const invocation = await payload.create({
    collection: 'pipeline-agent-invocations',
    data: {
      phase: input.phaseId,
      ...(input.ralphIterationId ? { ralphIteration: input.ralphIterationId } : {}),
      ...(modelId ? { model: modelId } : {}),
      systemPromptSnapshot: input.systemPrompt,
      userPrompt: input.prompt,
      startedAt,
      status: 'running',
    },
  })

  const { sink, stats } = makeTracerSink(payload, invocation.id as string)

  let output = ''
  let success = false
  let loopDetected = false
  let budgetExceeded = false
  let errorMessage: string | undefined

  try {
    const corePath = getCoreImportPath()
    const mod: any = await import(corePath)
    const ClaudeAgent = mod.ClaudeAgent ?? mod.default?.ClaudeAgent
    if (!ClaudeAgent) {
      throw new Error(`ClaudeAgent export not found at ${corePath}`)
    }

    const agent = new ClaudeAgent(
      { name: input.agentName, model: input.model, systemPrompt: input.systemPrompt },
      {
        systemPrompt: input.systemPrompt,
        cwd: input.cwd,
        maxTurns: input.maxTurns,
        maxBudgetUsd: input.maxBudgetUsd,
        permissionMode: input.permissionMode ?? 'acceptEdits',
        allowedTools: input.allowedTools,
        env: input.env,
        onEvent: sink,
      },
    )

    const result = await agent.run(input.prompt)
    output = result.output ?? ''
    success = result.success ?? true
    loopDetected = result.loopDetected ?? false
    budgetExceeded = result.budgetExceeded ?? false

    if (result.tokenUsage) {
      stats.tokensIn = result.tokenUsage.input_tokens ?? stats.tokensIn
      stats.tokensOut = result.tokenUsage.output_tokens ?? stats.tokensOut
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    payload.logger.error(`[coding-pipeline] runAgent failed: ${errorMessage}`)
  }

  const finishedAt = new Date()
  const durationMs = finishedAt.getTime() - startedAt.getTime()

  await payload.update({
    collection: 'pipeline-agent-invocations',
    id: invocation.id,
    data: {
      output,
      tokensIn: stats.tokensIn,
      tokensOut: stats.tokensOut,
      costUsd: stats.costUsd,
      sessionId: stats.sessionId,
      finishedAt,
      durationMs,
      status: errorMessage ? 'error' : success ? 'done' : 'failed',
      ...(errorMessage ? { errorMessage } : {}),
    },
  })

  if (errorMessage) {
    throw new Error(errorMessage)
  }

  return {
    output,
    costUsd: stats.costUsd,
    tokensIn: stats.tokensIn,
    tokensOut: stats.tokensOut,
    sessionId: stats.sessionId,
    budgetExceeded,
    loopDetected,
  }
}
