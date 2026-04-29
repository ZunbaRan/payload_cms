import type { CollectionConfig } from 'payload'

export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: {
    useAsTitle: 'name',
    group: '素材库',
    defaultColumns: ['name', 'slug', 'usageCount', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '标签名称' },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      label: 'Slug',
      admin: { position: 'sidebar' },
    },
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
      label: '使用次数',
    },
  ],
}
