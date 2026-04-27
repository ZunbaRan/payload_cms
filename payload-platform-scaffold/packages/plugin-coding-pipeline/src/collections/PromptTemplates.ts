import type { CollectionConfig } from 'payload'

/** Prompt 模板（替代 prompts.ts 里的 *_SYSTEM_PROMPT 常量） */
export const PromptTemplates: CollectionConfig = {
  slug: 'pipeline-prompt-templates',
  admin: { group: 'Coding Pipeline · Config', useAsTitle: 'label',
    defaultColumns: ['label', 'role', 'version', 'active'] },
  fields: [
    { name: 'label', type: 'text', required: true },
    { name: 'role', type: 'relationship', relationTo: 'pipeline-agent-roles', required: true },
    { name: 'version', type: 'number', required: true, defaultValue: 1 },
    { name: 'body', type: 'code', required: true,
      admin: { language: 'markdown',
        description: 'Full system prompt body. Will be passed to ClaudeAgent.systemPrompt verbatim.' } },
    { name: 'notes', type: 'textarea' },
    { name: 'active', type: 'checkbox', defaultValue: false,
      admin: { description: 'Marks this version as the active one for the role' } },
  ],
  indexes: [{ fields: ['role', 'version'], unique: true }],
}
