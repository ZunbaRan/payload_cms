import type { CollectionConfig } from 'payload'

export const AiModels: CollectionConfig = {
  slug: 'ai-models',
  admin: {
    useAsTitle: 'name',
    group: 'AI 引擎',
    defaultColumns: ['name', 'provider', 'modelId', 'isActive', 'priority'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    {
      name: 'provider',
      type: 'select',
      required: true,
      defaultValue: 'openai',
      options: [
        { label: 'OpenAI', value: 'openai' },
        { label: 'Anthropic Claude', value: 'anthropic' },
        { label: '智谱 Zhipu', value: 'zhipu' },
        { label: '火山方舟 ByteDance', value: 'bytedance' },
        { label: 'OpenAI 兼容', value: 'openai-compatible' },
      ],
      label: '供应商',
    },
    { name: 'modelId', type: 'text', required: true, label: '模型 ID', admin: { description: '例如 gpt-4o-mini' } },
    { name: 'baseUrl', type: 'text', label: 'API Base URL' },
    {
      name: 'apiKey',
      type: 'text',
      required: true,
      label: 'API Key',
      admin: { description: '生产环境建议加密存储或走环境变量引用' },
    },
    { name: 'temperature', type: 'number', defaultValue: 0.7, label: 'Temperature' },
    { name: 'maxTokens', type: 'number', defaultValue: 4096, label: 'Max Tokens' },
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
    {
      name: 'capabilities',
      type: 'select',
      hasMany: true,
      options: [
        { label: '文本生成', value: 'text' },
        { label: '函数调用', value: 'function-call' },
        { label: '视觉', value: 'vision' },
        { label: 'Embedding', value: 'embedding' },
      ],
      label: '能力',
    },
  ],
}
