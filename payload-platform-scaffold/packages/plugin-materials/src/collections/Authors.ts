import type { CollectionConfig } from 'payload'

export const Authors: CollectionConfig = {
  slug: 'authors',
  admin: {
    useAsTitle: 'name',
    group: '素材库',
    defaultColumns: ['name', 'email', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '作者名' },
    { name: 'slug', type: 'text', unique: true, label: 'Slug' },
    { name: 'email', type: 'email', label: '邮箱' },
    { name: 'avatar', type: 'upload', relationTo: 'images', label: '头像' },
    { name: 'bio', type: 'textarea', label: '简介' },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
  ],
}
