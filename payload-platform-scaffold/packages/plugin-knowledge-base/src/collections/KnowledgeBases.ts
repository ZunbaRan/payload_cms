import type {
  CollectionAfterChangeHook,
  CollectionBeforeDeleteHook,
  CollectionConfig,
} from 'payload'
import { ragSearchEndpoint } from '../endpoints/ragSearch'
import { reindexEndpoint } from '../endpoints/reindex'

/**
 * 删除 KB 前先级联清理子表：knowledge-chunks / kb-index-runs。
 * 否则 SQLite 会报 NOT NULL constraint failed: knowledge_chunks.knowledge_base_id
 * （Payload 默认会尝试把外键置 NULL，但子字段是 required）。
 */
const cascadeCleanupBeforeDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await req.payload.delete({
    collection: 'knowledge-chunks',
    where: { knowledgeBase: { equals: id } },
    overrideAccess: true,
  })
  await req.payload.delete({
    collection: 'kb-index-runs',
    where: { knowledgeBase: { equals: id } },
    overrideAccess: true,
  })
}

/**
 * 当 rawContent 改变时仅把状态置回 pending（"待索引"），不再自动切块。
 * 真正的切块/向量化通过点击右上角「📚 开始索引」按钮触发。
 */
const invalidateOnRawChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  if (context?.skipChunk) return doc
  const prev = (previousDoc as { rawContent?: string } | undefined)?.rawContent
  const curr = (doc as { rawContent?: string }).rawContent
  if (prev === curr) return doc
  await req.payload.update({
    collection: 'knowledge-bases',
    id: (doc as { id: string | number }).id,
    data: { syncStatus: 'pending' } as never,
    depth: 0,
    overrideAccess: true,
    context: { skipChunk: true },
  })
  return doc
}

export const KnowledgeBases: CollectionConfig = {
  slug: 'knowledge-bases',
  admin: {
    useAsTitle: 'name',
    group: '知识库',
    defaultColumns: ['name', 'sourceType', 'chunkCount', 'syncStatus', 'updatedAt'],
    components: {
      edit: {
        beforeDocumentControls: [
          '@scaffold/plugin-knowledge-base/admin/KnowledgeBaseActions#default',
        ],
      },
    },
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  endpoints: [ragSearchEndpoint, reindexEndpoint],
  hooks: {
    afterChange: [invalidateOnRawChange],
    beforeDelete: [cascadeCleanupBeforeDelete],
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
    {
      name: 'uploadedFile',
      type: 'relationship',
      relationTo: 'kb-uploads',
      label: '上传文件',
      admin: {
        condition: (data: Record<string, unknown> | undefined) =>
          (data?.sourceType as string | undefined) === 'file',
        description: '上传 .txt / .md / .csv / .json，开始索引时自动读入「原始内容」',
      },
    },
    {
      name: 'sourceUrl',
      type: 'text',
      label: '来源 URL',
      admin: {
        condition: (data: Record<string, unknown> | undefined) =>
          (data?.sourceType as string | undefined) === 'url',
      },
    },
    {
      name: 'rawContent',
      type: 'textarea',
      label: '原始内容',
      admin: { rows: 6, description: '索引时切块的实际文本（可由 agent 抓取或文件上传后回填）' },
    },
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
      type: 'relationship',
      relationTo: 'ai-models',
      label: 'Embedding 模型',
      admin: { description: '只能选择 embedding 类型的模型' },
      filterOptions: () => ({
        modelType: { equals: 'embedding' },
        isActive: { equals: true },
      }),
    },
    {
      name: 'syncStatus',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '待索引', value: 'pending' },
        { label: '索引中', value: 'syncing' },
        { label: '已索引', value: 'synced' },
        { label: '失败', value: 'failed' },
      ],
      admin: { position: 'sidebar', readOnly: true },
      label: '索引状态',
    },
    {
      name: 'chunkCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
      label: '分块数量',
    },
    {
      name: 'lastSyncedAt',
      type: 'date',
      admin: { position: 'sidebar', readOnly: true },
      label: '最后索引时间',
    },
  ],
}
