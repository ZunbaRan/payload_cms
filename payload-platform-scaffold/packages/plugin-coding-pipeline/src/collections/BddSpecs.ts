import type { CollectionConfig } from 'payload'

/** specs/<feature>.md 文件 */
export const BddSpecs: CollectionConfig = {
  slug: 'pipeline-bdd-specs',
  admin: { group: 'Coding Pipeline · Artifacts',
    defaultColumns: ['change', 'fileName', 'scenarioCount'],
    useAsTitle: 'fileName' },
  fields: [
    { name: 'change', type: 'relationship', relationTo: 'pipeline-openspec-changes', required: true },
    { name: 'fileName', type: 'text', required: true,
      admin: { description: 'e.g. login.md (relative to specs/)' } },
    { name: 'content', type: 'code', required: true, admin: { language: 'markdown' } },
    { name: 'scenarioCount', type: 'number',
      admin: { description: 'Auto-counted WHEN/THEN scenarios' } },
  ],
  indexes: [{ fields: ['change', 'fileName'], unique: true }],
}
