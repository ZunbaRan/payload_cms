import type { CollectionConfig } from 'payload'

export const SensitiveWords: CollectionConfig = {
  slug: 'sensitive-words',
  admin: {
    useAsTitle: 'word',
    group: '安全审核',
    defaultColumns: ['word', 'severity', 'action', 'isActive'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'word', type: 'text', required: true, unique: true, label: '敏感词' },
    {
      name: 'severity',
      type: 'select',
      defaultValue: 'medium',
      options: [
        { label: '低', value: 'low' },
        { label: '中', value: 'medium' },
        { label: '高', value: 'high' },
      ],
      label: '严重级别',
    },
    {
      name: 'action',
      type: 'select',
      defaultValue: 'flag',
      options: [
        { label: '仅标记', value: 'flag' },
        { label: '替换', value: 'replace' },
        { label: '阻止发布', value: 'block' },
      ],
      label: '处理动作',
    },
    { name: 'replacement', type: 'text', label: '替换文本' },
    { name: 'category', type: 'text', label: '分类' },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
  ],
}
