import type { CollectionConfig } from 'payload'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    group: '内容',
    defaultColumns: ['name', 'slug', 'parent', 'sortOrder'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: '分类名' },
    { name: 'slug', type: 'text', required: true, unique: true, label: 'Slug' },
    { name: 'description', type: 'textarea', label: '描述' },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      label: '父分类',
    },
    { name: 'sortOrder', type: 'number', defaultValue: 0, label: '排序', admin: { position: 'sidebar' } },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '启用',
      admin: { position: 'sidebar' },
    },
  ],
}
