import type { CollectionConfig } from 'payload'

export const SystemLogs: CollectionConfig = {
  slug: 'system-logs',
  admin: {
    useAsTitle: 'message',
    group: '安全审核',
    defaultColumns: ['level', 'channel', 'message', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'level',
      type: 'select',
      required: true,
      defaultValue: 'info',
      options: [
        { label: 'DEBUG', value: 'debug' },
        { label: 'INFO', value: 'info' },
        { label: 'WARNING', value: 'warning' },
        { label: 'ERROR', value: 'error' },
        { label: 'CRITICAL', value: 'critical' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'channel', type: 'text', label: '频道/模块' },
    { name: 'message', type: 'text', required: true, label: '消息' },
    { name: 'context', type: 'json', label: '上下文' },
    { name: 'stack', type: 'textarea', label: '堆栈' },
  ],
}
