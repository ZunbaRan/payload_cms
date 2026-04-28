import type { CollectionConfig } from 'payload'

export const Tasks: CollectionConfig = {
  slug: 'tasks',
  admin: {
    useAsTitle: 'name',
    group: '任务调度',
    defaultColumns: ['name', 'status', 'aiModel', 'lastRunAt', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '任务名' },
    { name: 'description', type: 'textarea', label: '描述' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'inactive',
      options: [
        { label: '未启动', value: 'inactive' },
        { label: '运行中', value: 'active' },
        { label: '已暂停', value: 'paused' },
        { label: '已完成', value: 'completed' },
        { label: '失败', value: 'failed' },
      ],
      admin: { position: 'sidebar' },
      label: '状态',
    },
    {
      name: 'titleLibrary',
      type: 'relationship',
      relationTo: 'title-libraries',
      label: '标题库',
    },
    {
      name: 'keywordLibrary',
      type: 'relationship',
      relationTo: 'keyword-libraries',
      label: '关键词库',
    },
    {
      name: 'imageLibrary',
      type: 'relationship',
      relationTo: 'image-libraries',
      label: '图片库',
    },
    {
      name: 'knowledgeBases',
      type: 'relationship',
      relationTo: 'knowledge-bases',
      hasMany: true,
      label: '关联知识库',
    },
    {
      name: 'prompt',
      type: 'relationship',
      relationTo: 'prompts',
      label: '使用 Prompt',
    },
    {
      name: 'aiModel',
      type: 'relationship',
      relationTo: 'ai-models',
      label: 'AI 模型',
    },
    {
      name: 'authorMode',
      type: 'select',
      defaultValue: 'fixed',
      options: [
        { label: '固定作者', value: 'fixed' },
        { label: '随机轮换', value: 'rotate' },
      ],
      label: '作者模式',
    },
    {
      name: 'authors',
      type: 'relationship',
      relationTo: 'authors',
      hasMany: true,
      label: '作者池',
    },
    {
      name: 'categoryMode',
      type: 'select',
      defaultValue: 'fixed',
      options: [
        { label: '固定分类', value: 'fixed' },
        { label: '自动匹配', value: 'auto' },
      ],
      label: '分类模式',
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      label: '默认分类',
    },
    {
      name: 'publishingPace',
      type: 'group',
      label: '发布节奏',
      fields: [
        { name: 'articlesPerDay', type: 'number', defaultValue: 1 },
        { name: 'minIntervalMinutes', type: 'number', defaultValue: 30 },
        { name: 'maxIntervalMinutes', type: 'number', defaultValue: 120 },
      ],
    },
    {
      name: 'autoPublish',
      type: 'checkbox',
      defaultValue: false,
      label: '生成后自动发布',
      admin: { position: 'sidebar' },
    },
    { name: 'lastRunAt', type: 'date', admin: { readOnly: true, position: 'sidebar' }, label: '上次运行' },
    { name: 'totalRuns', type: 'number', defaultValue: 0, admin: { readOnly: true, position: 'sidebar' } },
    { name: 'totalArticles', type: 'number', defaultValue: 0, admin: { readOnly: true, position: 'sidebar' } },
  ],
}
