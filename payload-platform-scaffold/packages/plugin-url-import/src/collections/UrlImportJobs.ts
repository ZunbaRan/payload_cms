import type { CollectionConfig } from 'payload'

export const UrlImportJobs: CollectionConfig = {
  slug: 'url-import-jobs',
  admin: {
    useAsTitle: 'name',
    group: 'URL 导入',
    defaultColumns: ['name', 'status', 'totalUrls', 'processedUrls', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '任务名' },
    {
      name: 'sourceType',
      type: 'select',
      defaultValue: 'list',
      options: [
        { label: 'URL 列表', value: 'list' },
        { label: 'RSS/Atom Feed', value: 'feed' },
        { label: '站点地图', value: 'sitemap' },
      ],
      label: '来源类型',
    },
    {
      name: 'urls',
      type: 'array',
      label: 'URL 列表',
      fields: [{ name: 'url', type: 'text', required: true }],
    },
    { name: 'feedUrl', type: 'text', label: 'Feed URL' },
    {
      name: 'targetCategory',
      type: 'relationship',
      relationTo: 'categories',
      label: '目标分类',
    },
    {
      name: 'targetKnowledgeBase',
      type: 'relationship',
      relationTo: 'knowledge-bases',
      label: '目标知识库',
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '等待中', value: 'pending' },
        { label: '运行中', value: 'running' },
        { label: '已完成', value: 'completed' },
        { label: '失败', value: 'failed' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'totalUrls', type: 'number', defaultValue: 0, admin: { readOnly: true, position: 'sidebar' } },
    { name: 'processedUrls', type: 'number', defaultValue: 0, admin: { readOnly: true, position: 'sidebar' } },
    { name: 'failedUrls', type: 'number', defaultValue: 0, admin: { readOnly: true, position: 'sidebar' } },
    { name: 'startedAt', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', type: 'date', admin: { readOnly: true } },
  ],
}
