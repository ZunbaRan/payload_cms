import type { CollectionConfig } from 'payload'
import path from 'path'

/**
 * 上传 PDF → 入队 processDocument 作业 → AI 摘要 → 自动建笔记
 */
export const Documents: CollectionConfig = {
  slug: 'documents',
  upload: {
    staticDir: path.resolve(process.cwd(), 'uploads/documents'),
    mimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
  },
  folders: true,
  admin: {
    useAsTitle: 'filename',
    group: '知识库',
    defaultColumns: ['filename', 'status', 'relatedNote', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => {
      const r = req.user?.role
      return r === 'admin' || r === 'editor'
    },
    update: ({ req }) => {
      if (!req.user) return false
      if (req.user.role === 'admin') return true
      if (req.user.role === 'editor') return { createdBy: { equals: req.user.id } }
      return false
    },
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '待处理', value: 'pending' },
        { label: '处理中', value: 'processing' },
        { label: '已完成', value: 'done' },
        { label: '失败', value: 'failed' },
      ],
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'summary',
      type: 'textarea',
      label: 'AI 摘要',
      admin: { readOnly: true, rows: 5 },
    },
    {
      name: 'keywords',
      type: 'text',
      hasMany: true,
      label: '关键词',
      admin: { readOnly: true },
    },
    {
      name: 'relatedNote',
      type: 'relationship',
      relationTo: 'notes',
      label: '自动生成的笔记',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'error',
      type: 'text',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
      access: { update: () => false },
    },
  ],
  hooks: {
    beforeChange: [
      ({ req, operation, data }) => {
        if (operation === 'create' && req.user && !data.createdBy) {
          data.createdBy = req.user.id
        }
        return data
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        if (operation !== 'create') return doc
        if ((req as any).__mvpDocProcessed) return doc
        ;(req as any).__mvpDocProcessed = true

        try {
          const job = await req.payload.jobs.queue({
            task: 'processDocument',
            input: { documentId: String(doc.id) },
          })
          req.payload.logger.info(
            `[documents] 已入队处理作业: doc=${doc.id} job=${(job as any)?.id ?? '?'}`,
          )
        } catch (err) {
          req.payload.logger.error(`[documents] 入队失败: ${(err as Error).message}`)
        }
        return doc
      },
    ],
  },
}
