import type { CollectionConfig } from 'payload'

export const TaskRuns: CollectionConfig = {
  slug: 'task-runs',
  admin: {
    useAsTitle: 'id',
    group: '任务调度',
    defaultColumns: ['task', 'status', 'startedAt', 'finishedAt', 'articlesCreated'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'task', type: 'relationship', relationTo: 'tasks', required: true, label: '任务' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'queued',
      options: [
        { label: '已排队', value: 'queued' },
        { label: '运行中', value: 'running' },
        { label: '成功', value: 'success' },
        { label: '失败', value: 'failed' },
        { label: '已取消', value: 'cancelled' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'startedAt', type: 'date', label: '开始时间' },
    { name: 'finishedAt', type: 'date', label: '结束时间' },
    { name: 'durationMs', type: 'number', label: '耗时（毫秒）' },
    {
      name: 'articlesCreated',
      type: 'relationship',
      relationTo: 'articles',
      hasMany: true,
      label: '产出文章',
    },
    { name: 'tokenUsage', type: 'json', label: 'Token 用量' },
    { name: 'logs', type: 'textarea', label: '日志', admin: { rows: 8 } },
    { name: 'errorMessage', type: 'textarea', label: '错误信息' },
  ],
}
