import type { Endpoint, PayloadRequest } from 'payload'

/**
 * GET /api/custom/search?q=xxx
 * 跨集合聚合搜索 notes/tasks/documents
 */
export const customSearchEndpoint: Endpoint = {
  path: '/custom/search',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url || '', 'http://localhost')
    const q = url.searchParams.get('q')?.trim() || ''
    if (!q) {
      return Response.json({ q: '', results: { notes: [], tasks: [], documents: [] } })
    }
    const [notes, tasks, documents] = await Promise.all([
      req.payload.find({
        collection: 'notes',
        where: { title: { like: q } },
        limit: 10,
        depth: 0,
      }),
      req.payload.find({
        collection: 'tasks',
        where: { title: { like: q } },
        limit: 10,
        depth: 0,
      }),
      req.payload.find({
        collection: 'documents',
        where: { filename: { like: q } },
        limit: 10,
        depth: 0,
      }),
    ])
    return Response.json({
      q,
      results: {
        notes: notes.docs.map((n: any) => ({ id: n.id, title: n.title })),
        tasks: tasks.docs.map((t: any) => ({ id: t.id, title: t.title, status: t.status })),
        documents: documents.docs.map((d: any) => ({ id: d.id, filename: d.filename })),
      },
    })
  },
}

/**
 * GET /api/custom/stats
 * Dashboard 统计聚合
 */
export const customStatsEndpoint: Endpoint = {
  path: '/custom/stats',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    const [notes, important, todo, done, docs] = await Promise.all([
      req.payload.count({ collection: 'notes' }),
      req.payload.count({ collection: 'notes', where: { isImportant: { equals: true } } }),
      req.payload.count({ collection: 'tasks', where: { status: { equals: 'todo' } } }),
      req.payload.count({ collection: 'tasks', where: { status: { equals: 'done' } } }),
      req.payload.count({ collection: 'documents' }),
    ])
    return Response.json({
      notes: notes.totalDocs,
      important: important.totalDocs,
      tasksTodo: todo.totalDocs,
      tasksDone: done.totalDocs,
      documents: docs.totalDocs,
    })
  },
}
