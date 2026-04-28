import type { CollectionConfig } from 'payload'

export const Prompts: CollectionConfig = {
  slug: 'prompts',
  admin: {
    useAsTitle: 'name',
    group: 'AI 引擎',
    defaultColumns: ['name', 'category', 'version', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'slug', type: 'text', unique: true, label: 'Slug' },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'content',
      options: [
        { label: '内容生成', value: 'content' },
        { label: '标题生成', value: 'title' },
        { label: '摘要', value: 'summary' },
        { label: 'SEO 优化', value: 'seo' },
        { label: '审核', value: 'review' },
        { label: '系统/特殊', value: 'system' },
      ],
      label: '类别',
    },
    {
      name: 'systemPrompt',
      type: 'textarea',
      label: 'System Prompt',
      admin: { rows: 6 },
    },
    {
      name: 'userTemplate',
      type: 'textarea',
      required: true,
      label: 'User 模板',
      admin: {
        rows: 10,
        description: '使用 {{variable}} 占位符。例如 {{title}} {{keywords}}',
      },
    },
    {
      name: 'variables',
      type: 'array',
      label: '变量定义',
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'defaultValue', type: 'text' },
      ],
    },
    {
      name: 'preferredModel',
      type: 'relationship',
      relationTo: 'ai-models',
      label: '首选模型',
    },
    { name: 'version', type: 'number', defaultValue: 1, label: '版本', admin: { position: 'sidebar' } },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
  ],
}
