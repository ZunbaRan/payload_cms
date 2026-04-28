import type { Endpoint, PayloadRequest } from 'payload'

/**
 * POST /api/agent-tasks/:id/run
 * 入队 processAgentTaskRun
 */
export const runAgentTaskEndpoint: Endpoint = {
  path: '/:id/run',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const id = (req.routeParams as { id?: string } | undefined)?.id
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const task = await req.payload.findByID({
      collection: 'agent-tasks',
      id,
      depth: 0,
    })
    if (!task) return Response.json({ error: 'Agent task not found' }, { status: 404 })

    let inputs: Record<string, string> | undefined
    try {
      const body = (await req.json?.()) as { inputs?: Record<string, string> } | undefined
      inputs = body?.inputs
    } catch {
      // no body
    }

    const taskRun = await req.payload.create({
      collection: 'agent-task-runs',
      data: {
        agentTask: id,
        status: 'queued',
        ...(inputs ? { inputs } : {}),
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    await req.payload.update({
      collection: 'agent-tasks',
      id,
      data: { lastRunStatus: 'queued' } as never,
      depth: 0,
      overrideAccess: true,
    })

    const job = await req.payload.jobs.queue({
      task: 'processAgentTaskRun',
      input: { agentTaskId: String(id), agentTaskRunId: String(taskRun.id) },
    })

    return Response.json({
      success: true,
      jobId: job.id,
      agentTaskRunId: taskRun.id,
    })
  },
}
