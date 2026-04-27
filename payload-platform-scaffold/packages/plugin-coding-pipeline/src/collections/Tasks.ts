import type { CollectionConfig } from 'payload'

/** 拆解后的实现任务（tasks.md 的结构化行） */
export const Tasks: CollectionConfig = {
  slug: 'pipeline-tasks',
  admin: { group: 'Coding Pipeline · Artifacts',
    defaultColumns: ['code', 'change', 'wave', 'status'],
    useAsTitle: 'code' },
  fields: [
    { name: 'change', type: 'relationship', relationTo: 'pipeline-openspec-changes', required: true },
    { name: 'code', type: 'text', required: true, admin: { description: 'e.g. T-01' } },
    { name: 'wave', type: 'number', required: true, defaultValue: 1 },
    { name: 'description', type: 'textarea', required: true },
    { name: 'files', type: 'array', fields: [{ name: 'path', type: 'text' }] },
    { name: 'depends', type: 'relationship', relationTo: 'pipeline-tasks', hasMany: true },
    { name: 'status', type: 'select', defaultValue: 'open',
      options: ['open', 'done', 'skipped'] },
  ],
  indexes: [{ fields: ['change', 'code'], unique: true }],
}
