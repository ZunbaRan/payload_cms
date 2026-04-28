import type { Endpoint, PayloadRequest } from 'payload'

/**
 * POST /api/knowledge-bases/:id/fetch-via-agent
 *
 * 走 agent-task 抓取来源 URL 内容回写到 KB.rawContent。
 * 创建：
 *   - 一条 agent-task-runs (linkedKnowledgeBase=KB, inputs={ url: KB.sourceUrl })
 *   - 一条 kb-index-runs   (kind=fetch, agentTaskRun=run.id)
 * 入队：processAgentTaskRun
 *
 * agent 完成后由 processAgentTaskRun 内部判断有没有 linkedKnowledgeBase，
 * 如果有则把 finalOutput（约定为绝对路径）的内容读入 KB.rawContent。
 */
export const fetchViaAgentEndpoint: Endpoint = {
  path: '/:id/fetch-via-agent',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const id = (req.routeParams as { id?: string } | undefined)?.id
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
    const numericId = Number.isFinite(Number(id)) ? Number(id) : id

    const kb = (await req.payload.findByID({
      collection: 'knowledge-bases',
      id: numericId,
      depth: 0,
    })) as {
      id: string | number
      sourceType?: string
      sourceUrl?: string
      fetchAgentTask?: string | number | { id: string | number }
    } | null
    if (!kb) return Response.json({ error: 'KnowledgeBase not found' }, { status: 404 })
    if (kb.sourceType !== 'url') {
      return Response.json({ error: '仅 sourceType=url 支持 agent 抓取' }, { status: 400 })
    }
    if (!kb.sourceUrl) return Response.json({ error: '缺少 sourceUrl' }, { status: 400 })
    if (!kb.fetchAgentTask) {
      return Response.json({ error: '请在 KB 上配置「抓取 Agent 任务」' }, { status: 400 })
    }
    const agentTaskId =
      typeof kb.fetchAgentTask === 'object'
        ? (kb.fetchAgentTask as { id: string | number }).id
        : kb.fetchAgentTask

    const taskRun = await req.payload.create({
      collection: 'agent-task-runs',
      data: {
        agentTask: agentTaskId,
        status: 'queued',
        inputs: { url: kb.sourceUrl },
        linkedKnowledgeBase: numericId,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    const indexRun = await req.payload.create({
      collection: 'kb-index-runs',
      data: {
        knowledgeBase: numericId,
        kind: 'fetch',
        status: 'queued',
        phase: 'fetching',
        progress: 0,
        agentTaskRun: taskRun.id,
        message: `调用 agent-task #${agentTaskId} 抓取 ${kb.sourceUrl}`,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    await req.payload.update({
      collection: 'agent-tasks',
      id: agentTaskId as string | number,
      data: { lastRunStatus: 'queued' } as never,
      depth: 0,
      overrideAccess: true,
    })

    const job = await req.payload.jobs.queue({
      task: 'processAgentTaskRun',
      input: {
        agentTaskId: String(agentTaskId),
        agentTaskRunId: String(taskRun.id),
        kbIndexRunId: String(indexRun.id),
      },
    })

    return Response.json({
      success: true,
      jobId: job.id,
      agentTaskRunId: taskRun.id,
      indexRunId: indexRun.id,
    })
  },
}
