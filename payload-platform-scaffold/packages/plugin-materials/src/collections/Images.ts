import type { CollectionConfig } from 'payload'
import { makeCountSyncHooks } from '../hooks/countSync'

const countHooks = makeCountSyncHooks({
  parentCollection: 'image-libraries',
  parentField: 'imageCount',
  childForeignKey: 'library',
})

export const Images: CollectionConfig = {
  slug: 'images',
  upload: {
    staticDir: 'media/images',
    mimeTypes: ['image/*'],
  },
  admin: {
    useAsTitle: 'alt',
    group: '素材库',
    defaultColumns: ['alt', 'library', 'usageCount', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    afterChange: [countHooks.afterChange],
    afterDelete: [countHooks.afterDelete],
  },
  fields: [
    { name: 'alt', type: 'text', label: 'Alt 文本' },
    {
      name: 'library',
      type: 'relationship',
      relationTo: 'image-libraries',
      label: '所属图片库',
    },
    { name: 'caption', type: 'text', label: '说明' },
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
      label: '使用次数',
    },
    { name: 'tags', type: 'text', hasMany: true, label: '标签' },
  ],
}
