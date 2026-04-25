import type { CollectionConfig } from 'payload'
import { sendCard } from '@mvp/shared/feishu'

export const Tasks: CollectionConfig = {
  slug: 'tasks',
  admin: {
    useAsTitle: 'title',
    group: '任务',
    defaultColumns: ['title', 'status', 'priority', 'dueDate', 'assignee'],
  },
  versions: { drafts: false, maxPerDoc: 10 },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => {
      const r = req.user?.role
      return r === 'admin' || r === 'editor'
    },
    update: ({ req }) => {
      if (!req.user) return false
      if (req.user.role === 'admin') return true
      if (req.user.role === 'editor') {
        return {
          or: [
            { createdBy: { equals: req.user.id } },
            { assignee: { equals: req.user.id } },
          ],
        }
      }
      return false
    },
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'title', type: 'text', required: true, label: '任务' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'todo',
      options: [
        { label: '待办', value: 'todo' },
        { label: '进行中', value: 'in_progress' },
        { label: '已完成', value: 'done' },
        { label: '已取消', value: 'cancelled' },
      ],
    },
    {
      name: 'priority',
      type: 'select',
      defaultValue: 'medium',
      options: [
        { label: '低', value: 'low' },
        { label: '中', value: 'medium' },
        { label: '高', value: 'high' },
      ],
    },
    { name: 'dueDate', type: 'date', label: '截止日期' },
    { name: 'description', type: 'textarea', label: '描述' },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'users',
      label: '指派给',
    },
    {
      name: 'relatedNote',
      type: 'relationship',
      relationTo: 'notes',
      label: '关联笔记',
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
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update') return doc
        if (doc.status !== 'done') return doc
        if (previousDoc?.status === 'done') return doc

        try {
          const base = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
          await sendCard({
            title: '✅ 任务完成',
            color: 'green',
            lines: [
              `**${doc.title}**`,
              `**优先级**：${doc.priority || 'medium'}`,
              doc.description ? `**描述**：${String(doc.description).slice(0, 80)}` : '',
            ].filter(Boolean),
            linkText: '查看任务',
            linkUrl: `${base}/admin/collections/tasks/${doc.id}`,
          })
          req.payload.logger.info(`[tasks] 飞书已通知任务完成: ${doc.title}`)
        } catch (err) {
          req.payload.logger.error(`[tasks] 飞书通知失败: ${(err as Error).message}`)
        }
        return doc
      },
    ],
  },
}
