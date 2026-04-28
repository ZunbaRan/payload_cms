import type { CollectionConfig } from 'payload'

export const KnowledgeChunks: CollectionConfig = {
  slug: 'knowledge-chunks',
  admin: {
    useAsTitle: 'preview',
    group: '知识库',
    defaultColumns: ['preview', 'knowledgeBase', 'chunkIndex', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'knowledgeBase',
      type: 'relationship',
      relationTo: 'knowledge-bases',
      required: true,
      label: '所属知识库',
    },
    {
      name: 'chunkIndex',
      type: 'number',
      required: true,
      label: '分块序号',
      admin: { position: 'sidebar' },
    },
    { name: 'content', type: 'textarea', required: true, label: '分块内容' },
    {
      name: 'preview',
      type: 'text',
      label: '预览',
      admin: { description: '前 80 字符', readOnly: true },
    },
    { name: 'tokenCount', type: 'number', label: 'Token 数', admin: { position: 'sidebar' } },
    {
      name: 'embedding',
      type: 'json',
      label: '向量',
      admin: { description: '由后端生成；正式部署建议接入向量库（pgvector / Chroma）' },
    },
    { name: 'metadata', type: 'json', label: '元数据' },
  ],
}
