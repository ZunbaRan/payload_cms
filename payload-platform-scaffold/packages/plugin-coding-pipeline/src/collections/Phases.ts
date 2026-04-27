import type { CollectionConfig } from 'payload'
import { PHASE_NAMES, PHASE_STATUSES } from '../types'

/** V3 五段中的一段 */
export const Phases: CollectionConfig = {
  slug: 'pipeline-phases',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['outerLoop', 'phaseName', 'status', 'costUsd', 'finishedAt'] },
  fields: [
    { name: 'outerLoop', type: 'relationship', relationTo: 'pipeline-outer-loops', required: true },
    { name: 'phaseName', type: 'select', required: true,
      options: PHASE_NAMES.map((p) => ({ label: p, value: p })) },
    { name: 'order', type: 'number', required: true,
      admin: { description: '0..4 — fixed by V3' } },
    { name: 'agentRole', type: 'relationship', relationTo: 'pipeline-agent-roles' },
    { name: 'promptSnapshot', type: 'relationship', relationTo: 'pipeline-prompt-templates',
      admin: { description: 'Frozen prompt version at the time this phase ran' } },
    { name: 'status', type: 'select', defaultValue: 'pending',
      options: PHASE_STATUSES.map((s) => ({ label: s, value: s })) },
    { name: 'startedAt', type: 'date' },
    { name: 'finishedAt', type: 'date' },
    { name: 'durationMs', type: 'number' },
    { name: 'costUsd', type: 'number', defaultValue: 0 },
    { name: 'tokensIn', type: 'number', defaultValue: 0 },
    { name: 'tokensOut', type: 'number', defaultValue: 0 },
    { name: 'headShaBefore', type: 'text' },
    { name: 'headShaAfter', type: 'text' },
    { name: 'gitDiff', type: 'code', admin: { language: 'diff' } },
    { name: 'rawOutput', type: 'textarea',
      admin: { description: 'Final agent output text (last iteration if Ralph)' } },
    { name: 'error', type: 'textarea' },
  ],
  indexes: [{ fields: ['outerLoop', 'order'], unique: true }],
  // TODO: afterChange hooks → validateOpenSpec (plan), reflectorVerdict (reflect)
}
