import type { CollectionConfig } from 'payload'
import { RUN_STATUSES } from '../types'

/** 一次完整的 pipeline 执行 */
export const Runs: CollectionConfig = {
  slug: 'pipeline-runs',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['id', 'requirement', 'status', 'totalCostUsd', 'startedAt'],
    useAsTitle: 'id' },
  fields: [
    { name: 'requirement', type: 'relationship', relationTo: 'pipeline-requirements', required: true },
    { name: 'project', type: 'relationship', relationTo: 'pipeline-projects', required: true,
      admin: { description: 'Denormalised from requirement.project for filter speed' } },
    { name: 'featureBranch', type: 'text' },
    { name: 'status', type: 'select', defaultValue: 'queued',
      options: RUN_STATUSES.map((s) => ({ label: s, value: s })) },
    { name: 'maxOuterLoops', type: 'number', defaultValue: 3 },
    { name: 'ralphMaxIterations', type: 'number', defaultValue: 20 },
    { name: 'autoAdvance', type: 'checkbox', defaultValue: true,
      admin: { description: 'When true, reflector verdict propagates immediately. When false, run pauses at awaiting-review until admin sets manualVerdict.' } },
    { name: 'totalCostUsd', type: 'number', defaultValue: 0 },
    { name: 'totalInputTokens', type: 'number', defaultValue: 0 },
    { name: 'totalOutputTokens', type: 'number', defaultValue: 0 },
    { name: 'startedAt', type: 'date' },
    { name: 'finishedAt', type: 'date' },
    { name: 'finalReflectorOutput', type: 'textarea' },
    { name: 'error', type: 'textarea' },
  ],
  // TODO: afterChange hook → schedule runPipeline job when status transitions to 'queued'
}
