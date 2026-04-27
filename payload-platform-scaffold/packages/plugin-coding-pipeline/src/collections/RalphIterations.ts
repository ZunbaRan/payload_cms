import type { CollectionConfig } from 'payload'

/** Tester 的 Ralph Loop 单轮记录 */
export const RalphIterations: CollectionConfig = {
  slug: 'pipeline-ralph-iterations',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['phase', 'iteration', 'completionDetected', 'costUsd'] },
  fields: [
    { name: 'phase', type: 'relationship', relationTo: 'pipeline-phases', required: true },
    { name: 'iteration', type: 'number', required: true },
    { name: 'prompt', type: 'textarea' },
    { name: 'output', type: 'textarea' },
    { name: 'completionDetected', type: 'checkbox', defaultValue: false },
    { name: 'tokensIn', type: 'number' },
    { name: 'tokensOut', type: 'number' },
    { name: 'costUsd', type: 'number' },
  ],
  indexes: [{ fields: ['phase', 'iteration'], unique: true }],
}
