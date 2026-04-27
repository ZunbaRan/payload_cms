import type { CollectionConfig } from 'payload'

/** 单次工具调用 */
export const ToolCalls: CollectionConfig = {
  slug: 'pipeline-tool-calls',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['invocation', 'toolName', 'durationMs'] },
  fields: [
    { name: 'invocation', type: 'relationship', relationTo: 'pipeline-agent-invocations', required: true },
    { name: 'toolName', type: 'text', required: true },
    { name: 'inputSummary', type: 'textarea' },
    { name: 'outputSummary', type: 'textarea' },
    { name: 'durationMs', type: 'number' },
    { name: 'isError', type: 'checkbox', defaultValue: false },
    { name: 'startedAt', type: 'date' },
  ],
}
