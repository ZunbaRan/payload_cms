import type { CollectionConfig } from 'payload'

/**
 * Notes Collection
 * 支持 AI 自动标签、重要性标注、向量索引状态追踪
 */
export const Notes: CollectionConfig = {
  slug: 'notes',
  admin: {
    useAsTitle: 'title',
    group: '内容管理',
    defaultColumns: ['title', 'tags', 'isImportant', 'vectorized', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: '标题',
    },
    {
      name: 'content',
      type: 'textarea',
      label: '内容',
    },
    // ─── AI 生成字段 ──────────────────────────────────────────────────────────
    {
      name: 'tags',
      type: 'text',
      hasMany: true,
      label: '标签（AI 生成）',
      admin: { readOnly: false },
    },
    {
      name: 'isImportant',
      type: 'checkbox',
      label: '重要',
      defaultValue: false,
      admin: { position: 'sidebar' },
    },
    {
      name: 'importanceReason',
      type: 'text',
      label: '重要性理由（AI）',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'aiProcessed',
      type: 'checkbox',
      label: 'AI 已处理',
      defaultValue: false,
      admin: { readOnly: true, position: 'sidebar' },
    },
    // ─── Chroma 向量状态 ──────────────────────────────────────────────────────
    {
      name: 'vectorized',
      type: 'checkbox',
      label: '已向量化',
      defaultValue: false,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'chromaId',
      type: 'text',
      label: 'Chroma 文档 ID',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
