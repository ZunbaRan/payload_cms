import type { CollectionConfig } from 'payload'

/** 一次 ClaudeAgent.run() 调用 */
export const AgentInvocations: CollectionConfig = {
  slug: 'pipeline-agent-invocations',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['phase', 'model', 'costUsd', 'tokensOut'] },
  fields: [
    { name: 'phase', type: 'relationship', relationTo: 'pipeline-phases', required: true },
    { name: 'ralphIteration', type: 'relationship', relationTo: 'pipeline-ralph-iterations',
      admin: { description: 'Set when this invocation happens inside a Ralph loop' } },
    { name: 'model', type: 'relationship', relationTo: 'pipeline-models' },
    { name: 'sessionId', type: 'text' },
    { name: 'systemPromptSnapshot', type: 'textarea' },
    { name: 'userPrompt', type: 'textarea' },
    { name: 'output', type: 'textarea' },
    { name: 'structured', type: 'json' },
    { name: 'tokensIn', type: 'number' },
    { name: 'tokensOut', type: 'number' },
    { name: 'costUsd', type: 'number' },
    { name: 'startedAt', type: 'date' },
    { name: 'finishedAt', type: 'date' },
    { name: 'durationMs', type: 'number' },
    { name: 'status', type: 'select',
      options: ['running', 'done', 'failed', 'error'], defaultValue: 'running' },
    { name: 'errorMessage', type: 'textarea' },
    { name: 'budgetExceeded', type: 'checkbox', defaultValue: false },
    { name: 'loopDetected', type: 'checkbox', defaultValue: false },
  ],
}
