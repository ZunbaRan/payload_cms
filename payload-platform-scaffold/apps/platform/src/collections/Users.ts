import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    // 测试项目：JWT 有效期 7 天，方便外部 AI 长时间调用 REST API
    tokenExpiration: 60 * 60 * 24 * 7,
  },
  admin: {
    useAsTitle: 'email',
    group: '系统管理',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [],
}
