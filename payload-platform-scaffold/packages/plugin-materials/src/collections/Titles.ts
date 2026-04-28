import type { CollectionConfig } from 'payload'
import { makeCountSyncHooks } from '../hooks/countSync'

const countHooks = makeCountSyncHooks({
  parentCollection: 'title-libraries',
  parentField: 'titleCount',
  childForeignKey: 'library',
})

export const Titles: CollectionConfig = {
  slug: 'titles',
  admin: {
    useAsTitle: 'text',
    group: '素材库',
    defaultColumns: ['text', 'library', 'status', 'updatedAt'],
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
    { name: 'text', type: 'text', required: true, label: '标题文本' },
    {
      name: 'library',
      type: 'relationship',
      relationTo: 'title-libraries',
      required: true,
      label: '所属标题库',
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '待使用', value: 'pending' },
        { label: '已使用', value: 'used' },
        { label: '已弃用', value: 'archived' },
      ],
      admin: { position: 'sidebar' },
      label: '状态',
    },
    {
      name: 'isAiGenerated',
      type: 'checkbox',
      defaultValue: false,
      label: 'AI 生成',
      admin: { position: 'sidebar' },
    },
    { name: 'sourceKeywords', type: 'text', hasMany: true, label: '来源关键词' },
  ],
}
