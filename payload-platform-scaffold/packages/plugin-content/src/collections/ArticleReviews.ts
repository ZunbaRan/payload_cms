import type { CollectionConfig } from 'payload'
import { articleReviewSyncHook } from '../hooks/articleReviewSync'

export const ArticleReviews: CollectionConfig = {
  slug: 'article-reviews',
  admin: {
    useAsTitle: 'id',
    group: '内容',
    defaultColumns: ['article', 'reviewer', 'decision', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    afterChange: [articleReviewSyncHook],
  },
  fields: [
    {
      name: 'article',
      type: 'relationship',
      relationTo: 'articles',
      required: true,
      label: '文章',
    },
    {
      name: 'reviewer',
      type: 'relationship',
      relationTo: 'users',
      label: '审核人',
    },
    {
      name: 'decision',
      type: 'select',
      required: true,
      options: [
        { label: '通过', value: 'approved' },
        { label: '驳回', value: 'rejected' },
        { label: '待修改', value: 'needs-revision' },
      ],
      label: '决议',
    },
    { name: 'comment', type: 'textarea', label: '审核意见' },
    { name: 'flaggedKeywords', type: 'text', hasMany: true, label: '命中敏感词' },
  ],
}
