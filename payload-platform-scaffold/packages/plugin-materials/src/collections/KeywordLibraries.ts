import type { CollectionConfig } from 'payload'

export const KeywordLibraries: CollectionConfig = {
  slug: 'keyword-libraries',
  admin: {
    useAsTitle: 'name',
    group: '素材库',
    defaultColumns: ['name', 'keywordCount', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'description', type: 'textarea', label: '描述' },
    {
      name: 'keywordCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
      label: '关键词数量',
    },
  ],
}
