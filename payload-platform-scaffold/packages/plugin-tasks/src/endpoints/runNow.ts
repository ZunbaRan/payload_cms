import type { Endpoint, PayloadRequest } from 'payload'

/**
 * POST /api/tasks/:id/run
 * 把指定 task 入队 processTaskRun。
 */
export const runNowEndpoint: Endpoint = {
  path: '/:id/run',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    const user = req.user
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const id = (req.routeParams as { id?: string } | undefined)?.id
    if (!id) {
      return Response.json({ error: 'Missing task id' }, { status: 400 })
    }

    const task = await req.payload.findByID({ collection: 'tasks', id, depth: 0 })
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }

    const taskRun = await req.payload.create({
      collection: 'task-runs',
      data: {
        task: id,
        status: 'queued',
        triggerType: 'manual',
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    const job = await req.payload.jobs.queue({
      task: 'processTaskRun',
      input: { taskId: String(id), taskRunId: String(taskRun.id) },
    })

    return Response.json({
      success: true,
      jobId: job.id,
      taskRunId: taskRun.id,
    })
  },
}
