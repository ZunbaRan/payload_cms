import type { TaskConfig } from 'payload'
import { runPipelineHandler } from './runPipeline'
import { runPhaseHandler } from './runPhase'
import { archiveOpenSpecHandler } from './archiveOpenSpec'

/**
 * 全部 task 配置；plugin 入口将其合入 payload.config.jobs.tasks。
 */
export const tasks: TaskConfig[] = [
  {
    slug: 'runPipeline',
    inputSchema: [{ name: 'runId', type: 'text', required: true }],
    handler: runPipelineHandler as any,
  },
  {
    slug: 'runPhase',
    inputSchema: [{ name: 'phaseId', type: 'text', required: true }],
    handler: runPhaseHandler as any,
  },
  {
    slug: 'archiveOpenSpec',
    inputSchema: [{ name: 'changeId', type: 'text', required: true }],
    handler: archiveOpenSpecHandler as any,
  },
]

export { runPipelineHandler, runPhaseHandler, archiveOpenSpecHandler }
