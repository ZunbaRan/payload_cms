import type { Endpoint, PayloadRequest } from 'payload'

/**
 * POST /api/knowledge-bases/:id/reindex
 * 创建一条 kb-index-runs，入队 indexKnowledgeBase 任务
 */
export const reindexEndpoint: Endpoint = {
  path: '/:id/reindex',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const id = (req.routeParams as { id?: string } | undefined)?.id
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
    const numericId = Number.isFinite(Number(id)) ? Number(id) : id

    const kb = await req.payload.findByID({
      collection: 'knowledge-bases',
      id: numericId,
      depth: 0,
    })
    if (!kb) return Response.json({ error: 'KnowledgeBase not found' }, { status: 404 })

    const run = await req.payload.create({
      collection: 'kb-index-runs',
      data: {
        knowledgeBase: numericId,
        kind: 'index',
        status: 'queued',
        phase: 'pending',
        progress: 0,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    const job = await req.payload.jobs.queue({
      task: 'indexKnowledgeBase',
      input: { knowledgeBaseId: String(id), indexRunId: String(run.id) },
    })

    return Response.json({ success: true, jobId: job.id, indexRunId: run.id })
  },
}
