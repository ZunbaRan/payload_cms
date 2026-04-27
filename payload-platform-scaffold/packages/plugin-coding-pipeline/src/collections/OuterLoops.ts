import type { CollectionConfig } from 'payload'
import { VERDICTS } from '../types'

/** 一次外层循环（Reflector REVISE → 新建一条） */
export const OuterLoops: CollectionConfig = {
  slug: 'pipeline-outer-loops',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['run', 'loopIndex', 'verdict', 'manualVerdict'] },
  fields: [
    { name: 'run', type: 'relationship', relationTo: 'pipeline-runs', required: true },
    { name: 'loopIndex', type: 'number', required: true,
      admin: { description: '0-based index inside the run' } },
    { name: 'requirementText', type: 'textarea', required: true,
      admin: { description: 'Either original requirement or REVISE: text from previous loop' } },
    { name: 'status', type: 'select', defaultValue: 'pending',
      options: ['pending', 'running', 'awaiting-review', 'accepted', 'revising', 'rejected', 'error'] },
    { name: 'verdict', type: 'select',
      options: VERDICTS.map((v) => ({ label: v, value: v })),
      admin: { description: 'Set automatically by reflectorVerdict hook' } },
    { name: 'reflectorOutput', type: 'textarea' },
    { name: 'manualVerdict', type: 'select',
      options: VERDICTS.map((v) => ({ label: v, value: v })),
      admin: { description: 'Admin override; takes precedence over auto verdict' } },
    { name: 'manualNote', type: 'textarea',
      admin: { description: 'When admin sets revise, this becomes the new requirementText for next loop' } },
    { name: 'reviewedBy', type: 'relationship', relationTo: 'users' },
  ],
  indexes: [{ fields: ['run', 'loopIndex'], unique: true }],
  // TODO: afterChange hook → reflectorVerdict / manual override → spawn next loop or archive
}
