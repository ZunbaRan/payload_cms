import type { CollectionConfig } from 'payload'

export const TaskSchedules: CollectionConfig = {
  slug: 'task-schedules',
  admin: {
    useAsTitle: 'name',
    group: '任务调度',
    defaultColumns: ['name', 'task', 'cron', 'isActive', 'nextRunAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'task', type: 'relationship', relationTo: 'tasks', required: true, label: '任务' },
    {
      name: 'cron',
      type: 'text',
      required: true,
      label: 'Cron 表达式',
      admin: { description: '例如 0 */2 * * *（每 2 小时）' },
    },
    { name: 'timezone', type: 'text', defaultValue: 'Asia/Shanghai', label: '时区' },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
    { name: 'lastRunAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
    { name: 'nextRunAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
  ],
}
