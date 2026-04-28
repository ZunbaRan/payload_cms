import type { CollectionConfig } from 'payload'

export const ActivityLogs: CollectionConfig = {
  slug: 'activity-logs',
  admin: {
    useAsTitle: 'action',
    group: '安全审核',
    defaultColumns: ['user', 'action', 'targetType', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', label: '操作者' },
    { name: 'action', type: 'text', required: true, label: '动作' },
    { name: 'targetType', type: 'text', label: '对象类型' },
    { name: 'targetId', type: 'text', label: '对象 ID' },
    { name: 'ip', type: 'text', label: 'IP 地址' },
    { name: 'userAgent', type: 'text', label: 'User Agent' },
    { name: 'metadata', type: 'json', label: '元数据' },
  ],
}
