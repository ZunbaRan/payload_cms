import type { CollectionConfig } from 'payload'

export const KnowledgeBases: CollectionConfig = {
  slug: 'knowledge-bases',
  admin: {
    useAsTitle: 'name',
    group: '知识库',
    defaultColumns: ['name', 'chunkCount', 'syncStatus', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'description', type: 'textarea', label: '描述' },
    {
      name: 'sourceType',
      type: 'select',
      defaultValue: 'manual',
      options: [
        { label: '手动录入', value: 'manual' },
        { label: '文件上传', value: 'file' },
        { label: 'URL 抓取', value: 'url' },
      ],
      label: '来源类型',
    },
    { name: 'sourceUrl', type: 'text', label: '来源 URL' },
    { name: 'rawContent', type: 'textarea', label: '原始内容' },
    {
      name: 'chunkSize',
      type: 'number',
      defaultValue: 800,
      label: '分块大小（字符）',
    },
    {
      name: 'chunkOverlap',
      type: 'number',
      defaultValue: 100,
      label: '分块重叠',
    },
    {
      name: 'embeddingModel',
      type: 'text',
      label: 'Embedding 模型',
      admin: { description: '例如 text-embedding-3-small' },
    },
    {
      name: 'syncStatus',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '待同步', value: 'pending' },
        { label: '同步中', value: 'syncing' },
        { label: '已同步', value: 'synced' },
        { label: '失败', value: 'failed' },
      ],
      admin: { position: 'sidebar' },
      label: '同步状态',
    },
    {
      name: 'chunkCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
      label: '分块数量',
    },
    { name: 'lastSyncedAt', type: 'date', admin: { position: 'sidebar' }, label: '最后同步时间' },
  ],
}
