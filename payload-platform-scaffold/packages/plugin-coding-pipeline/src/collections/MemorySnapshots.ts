import type { CollectionConfig } from 'payload'

/** MEMORY.md 在每个 phase 后的快照 */
export const MemorySnapshots: CollectionConfig = {
  slug: 'pipeline-memory-snapshots',
  admin: { group: 'Coding Pipeline · Artifacts',
    defaultColumns: ['phase', 'createdAt'] },
  fields: [
    { name: 'run', type: 'relationship', relationTo: 'pipeline-runs', required: true },
    { name: 'phase', type: 'relationship', relationTo: 'pipeline-phases', required: true },
    { name: 'content', type: 'code', required: true, admin: { language: 'markdown' } },
    { name: 'gitDiffSha', type: 'text' },
  ],
}
