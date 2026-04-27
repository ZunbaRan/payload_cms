import type { CollectionConfig } from 'payload'

/** 一个 openspec change 目录的 DB 镜像（source of truth = DB；hook 渲染回文件） */
export const OpenSpecChanges: CollectionConfig = {
  slug: 'pipeline-openspec-changes',
  admin: { group: 'Coding Pipeline · Artifacts',
    defaultColumns: ['name', 'run', 'archived'],
    useAsTitle: 'name' },
  fields: [
    { name: 'run', type: 'relationship', relationTo: 'pipeline-runs', required: true },
    { name: 'outerLoop', type: 'relationship', relationTo: 'pipeline-outer-loops', required: true },
    { name: 'name', type: 'text', required: true,
      admin: { description: 'Slug used for openspec/changes/<name>/' } },
    { name: 'proposalMd', type: 'code', admin: { language: 'markdown' } },
    { name: 'designMd', type: 'code', admin: { language: 'markdown' } },
    { name: 'tasksMd', type: 'code', admin: { language: 'markdown' },
      admin_description: 'Raw tasks.md; structured rows live in pipeline-tasks' },
    { name: 'archived', type: 'checkbox', defaultValue: false },
    { name: 'archivedAt', type: 'date' },
  ],
}
