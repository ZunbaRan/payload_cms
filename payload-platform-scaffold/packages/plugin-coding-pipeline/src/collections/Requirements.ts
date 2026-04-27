import type { CollectionConfig } from 'payload'

/** 用户提交的需求 */
export const Requirements: CollectionConfig = {
  slug: 'pipeline-requirements',
  admin: { group: 'Coding Pipeline · Workspace',
    defaultColumns: ['title', 'project', 'status', 'createdAt'],
    useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'project', type: 'relationship', relationTo: 'pipeline-projects', required: true },
    { name: 'text', type: 'textarea', required: true },
    { name: 'status', type: 'select', defaultValue: 'pending',
      options: ['pending', 'running', 'done', 'cancelled'] },
    { name: 'submittedBy', type: 'relationship', relationTo: 'users' },
  ],
}
