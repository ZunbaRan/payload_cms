import type { CollectionConfig } from 'payload'

/** Skill 注册表（对应 .claude/skills/ 目录的内容） */
export const Skills: CollectionConfig = {
  slug: 'pipeline-skills',
  admin: { group: 'Coding Pipeline · Config', useAsTitle: 'slug' },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'displayName', type: 'text' },
    { name: 'source', type: 'select', defaultValue: 'bundled',
      options: ['bundled', 'url', 'local'] },
    { name: 'sourceRef', type: 'text',
      admin: { description: 'URL or local path; ignored when source=bundled' } },
    { name: 'version', type: 'text' },
    { name: 'description', type: 'textarea' },
  ],
}
