import type { CollectionConfig } from 'payload'
import { testConnectionEndpoint } from '../endpoints/testConnection'

export const AiModels: CollectionConfig = {
  slug: 'ai-models',
  admin: {
    useAsTitle: 'name',
    group: 'AI 引擎',
    defaultColumns: ['name', 'modelType', 'provider', 'modelId', 'isActive', 'priority'],
    components: {
      edit: {
        beforeDocumentControls: [
          '@scaffold/plugin-ai-engine/admin/AiModelTestButton#default',
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
  endpoints: [testConnectionEndpoint],
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    {
      name: 'modelType',
      type: 'select',
      required: true,
      defaultValue: 'text',
      options: [
        { label: '文本生成', value: 'text' },
        { label: 'Embedding（向量嵌入）', value: 'embedding' },
        { label: '图片生成', value: 'image' },
        { label: '视频生成', value: 'video' },
      ],
      label: '模型类型',
      admin: {
        description: '决定模型用途；不同类型互斥（embedding 不能用于文本生成）',
        position: 'sidebar',
      },
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      defaultValue: 'openai',
      options: [
        { label: '本地（transformers.js）', value: 'local' },
        { label: 'OpenAI', value: 'openai' },
        { label: 'Anthropic Claude', value: 'anthropic' },
        { label: '智谱 Zhipu', value: 'zhipu' },
        { label: '火山方舟 ByteDance', value: 'bytedance' },
        { label: 'OpenAI 兼容（DeepSeek/通义/ollama 等）', value: 'openai-compatible' },
      ],
      label: '供应商',
    },
    { name: 'modelId', type: 'text', required: true, label: '模型 ID', admin: { description: '例如 gpt-4o-mini；本地模型例如 Xenova/all-MiniLM-L6-v2' } },
    { name: 'baseUrl', type: 'text', label: 'API Base URL' },
    {
      name: 'apiKey',
      type: 'text',
      label: 'API Key',
      admin: { description: '生产环境建议加密存储或走环境变量引用；本地模型可留空' },
    },
    {
      name: 'temperature',
      type: 'number',
      defaultValue: 0.7,
      label: 'Temperature',
      admin: {
        condition: (data) => data?.modelType !== 'embedding',
      },
    },
    {
      name: 'maxTokens',
      type: 'number',
      defaultValue: 4096,
      label: 'Max Tokens',
      admin: {
        condition: (data) => data?.modelType !== 'embedding',
      },
    },
    {
      name: 'embeddingDimensions',
      type: 'number',
      label: '向量维度',
      admin: {
        description: '可选；不填则由模型自行决定（如 OpenAI text-embedding-3-small 默认 1536）',
        condition: (data) => data?.modelType === 'embedding',
      },
    },
    { name: 'dailyRequestLimit', type: 'number', label: '每日请求上限' },
    { name: 'dailyTokenLimit', type: 'number', label: '每日 Token 上限' },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 100,
      label: '优先级（越小越优先）',
      admin: { position: 'sidebar' },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
  ],
}
