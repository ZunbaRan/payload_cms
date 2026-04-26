import type { CollectionConfig } from 'payload'

/**
 * TokenUsage Collection — Finly 模式复刻
 *
 * 记录每次 AI 调用的模型、token 用量、完整消息（含 system/user/assistant），
 * 在 Admin 里可直接审查生产环境中真实的 Prompt 和 AI 响应。
 */
export const TokenUsage: CollectionConfig = {
  slug: 'token-usages',
  admin: {
    useAsTitle: 'modelId',
    group: 'AI 管理',
    defaultColumns: ['modelId', 'scene', 'totalTokens', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => true,   // Job 内部写入，不校验用户
    update: () => false,
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'modelId',
      type: 'text',
      label: '模型 ID',
      required: true,
    },
    {
      name: 'scene',
      type: 'select',
      label: '场景',
      required: true,
      options: [
        { label: '标签生成', value: 'generateTags' },
        { label: '重要性判断', value: 'classifyImportance' },
        { label: '文档摘要', value: 'summarizeDocument' },
        { label: '语义搜索', value: 'semanticSearch' },
        { label: '其他', value: 'other' },
      ],
    },
    // ─── Token 用量 ──────────────────────────────────────────────────────────
    {
      name: 'inputTokens',
      type: 'number',
      label: '输入 Token',
    },
    {
      name: 'outputTokens',
      type: 'number',
      label: '输出 Token',
    },
    {
      name: 'totalTokens',
      type: 'number',
      label: '合计 Token',
    },
    // ─── 完整消息记录 ─────────────────────────────────────────────────────────
    {
      name: 'messages',
      type: 'array',
      label: '消息记录',
      admin: { description: '完整的 prompt + AI 回复，含 system/user/assistant 角色' },
      fields: [
        {
          name: 'role',
          type: 'select',
          required: true,
          options: ['system', 'user', 'assistant'],
        },
        {
          name: 'content',
          type: 'textarea',
          required: true,
        },
      ],
    },
    // ─── 关联来源 ─────────────────────────────────────────────────────────────
    {
      name: 'relatedNote',
      type: 'relationship',
      relationTo: 'notes',
      label: '关联笔记',
      admin: { position: 'sidebar' },
    },
    {
      name: 'error',
      type: 'text',
      label: '错误信息',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
