import type { CollectionConfig } from 'payload'

export const UrlImportJobLogs: CollectionConfig = {
  slug: 'url-import-job-logs',
  admin: {
    useAsTitle: 'url',
    group: 'URL 导入',
    defaultColumns: ['job', 'url', 'status', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'job',
      type: 'relationship',
      relationTo: 'url-import-jobs',
      required: true,
      label: '所属任务',
    },
    { name: 'url', type: 'text', required: true, label: 'URL' },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: '成功', value: 'success' },
        { label: '失败', value: 'failed' },
        { label: '跳过', value: 'skipped' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'httpStatus', type: 'number', label: 'HTTP 状态码' },
    { name: 'extractedTitle', type: 'text', label: '提取的标题' },
    { name: 'contentLength', type: 'number', label: '内容长度' },
    {
      name: 'createdArticle',
      type: 'relationship',
      relationTo: 'articles',
      label: '创建的文章',
    },
    {
      name: 'createdKnowledgeBase',
      type: 'relationship',
      relationTo: 'knowledge-bases',
      label: '创建的知识库',
    },
    { name: 'errorMessage', type: 'textarea', label: '错误信息' },
  ],
}
