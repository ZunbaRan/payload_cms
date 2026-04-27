import type { CollectionConfig } from 'payload'

/** LLM 模型注册表（替代 DEFAULT_MODEL 环境变量） */
export const Models: CollectionConfig = {
  slug: 'pipeline-models',
  admin: { group: 'Coding Pipeline · Config', useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true,
      admin: { description: 'e.g. claude-sonnet-4-6' } },
    { name: 'provider', type: 'select', defaultValue: 'anthropic',
      options: ['anthropic', 'openai', 'openrouter', 'custom'] },
    { name: 'contextWindow', type: 'number' },
    { name: 'costPer1kInUsd', type: 'number' },
    { name: 'costPer1kOutUsd', type: 'number' },
    { name: 'enabled', type: 'checkbox', defaultValue: true },
    { name: 'notes', type: 'textarea' },
  ],
}
