import type { CollectionConfig } from 'payload'

/**
 * Notes 集合
 * P5: access control + createdBy
 * P6: richText (Lexical) 内容；relationship 到 tasks/documents；versions + drafts + autosave
 * P7: AI 处理走 Jobs Queue（异步）；hook 只负责入队
 * P11: 配合 nested-docs 插件（由插件自动注入 parent/breadcrumbs 字段）
 */
export const Notes: CollectionConfig = {
  slug: 'notes',
  admin: {
    useAsTitle: 'title',
    group: '知识库',
    defaultColumns: ['title', 'tags', 'isImportant', 'updatedAt'],
  },
  versions: {
    drafts: {
      autosave: { interval: 2000 },
      schedulePublish: true,
    },
    maxPerDoc: 20,
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
    { name: 'title', type: 'text', required: true, label: '标题' },
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: '内容',
    },
    {
      name: 'tags',
      type: 'text',
      hasMany: true,
      label: '标签（AI 自动生成）',
      admin: { description: '留空时保存后会由 AI 自动生成；手动填写将被保留' },
    },
    {
      name: 'relatedTasks',
      type: 'relationship',
      relationTo: 'tasks',
      hasMany: true,
      label: '关联任务',
    },
    {
      name: 'relatedDocuments',
      type: 'relationship',
      relationTo: 'documents',
      hasMany: true,
      label: '关联文档',
    },
    {
      name: 'isImportant',
      type: 'checkbox',
      label: '重要笔记',
      defaultValue: false,
      admin: { description: '由 AI 判定，标为重要时会发飞书提醒', position: 'sidebar' },
    },
    {
      name: 'importanceReason',
      type: 'text',
      label: 'AI 判定理由',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'aiProcessed',
      type: 'checkbox',
      label: '已被 AI 处理',
      defaultValue: false,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'aiJobId',
      type: 'text',
      label: 'AI 作业 ID',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'source',
      type: 'text',
      label: '来源',
      admin: { description: '手动 / 由 PDF 自动生成', position: 'sidebar' },
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
      async ({ doc, req, operation }) => {
        if ((req as any).__mvpNotesAIDone) return doc
        const needProcess = operation === 'create' || !doc.aiProcessed
        if (!needProcess) return doc
        ;(req as any).__mvpNotesAIDone = true

        try {
          const job = await req.payload.jobs.queue({
            task: 'generateNoteTags',
            input: { noteId: String(doc.id) },
          })
          req.payload.logger.info(
            `[notes] 已入队 AI 处理作业: note=${doc.id} job=${(job as any)?.id ?? '?'}`,
          )
        } catch (err) {
          req.payload.logger.error(`[notes] 入队失败: ${(err as Error).message}`)
        }
        return doc
      },
    ],
  },
}
