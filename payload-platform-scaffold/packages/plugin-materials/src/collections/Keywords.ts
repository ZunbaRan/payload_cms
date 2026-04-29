import type { CollectionConfig } from 'payload'
import { makeCountSyncHooks } from '../hooks/countSync'

const countHooks = makeCountSyncHooks({
  parentCollection: 'keyword-libraries',
  parentField: 'keywordCount',
  childForeignKey: 'library',
})

export const Keywords: CollectionConfig = {
  slug: 'keywords',
  admin: {
    useAsTitle: 'text',
    group: '素材库',
    defaultColumns: ['text', 'library', 'weight', 'updatedAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    afterChange: [countHooks.afterChange],
    afterDelete: [countHooks.afterDelete],
  },
  fields: [
    { name: 'text', type: 'text', required: true, label: '关键词' },
    {
      name: 'library',
      type: 'relationship',
      relationTo: 'keyword-libraries',
      required: true,
      label: '所属关键词库',
    },
    {
      name: 'weight',
      type: 'number',
      defaultValue: 1,
      label: '权重',
      admin: { position: 'sidebar' },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      label: '标签',
    },
  ],
}
