import type { CollectionConfig } from 'payload'

/**
 * Tenants 集合 — multi-tenant 插件的租户主表
 *
 * multi-tenant 插件会自动给其他 collection 注入 `tenant` 关联字段，
 * 并根据当前用户所属租户自动过滤列表。
 *
 * 演示场景：
 *   - 企业 A / 企业 B 分别看不到对方的 contracts / notes / tasks
 *   - 超级管理员可以切换租户视图
 */
export const Tenants: CollectionConfig = {
  slug: 'tenants',
  admin: {
    useAsTitle: 'name',
    group: '系统管理',
    description: '租户（客户公司）管理，multi-tenant 插件主表',
  },
  access: {
    // 只有 admin 才能管理租户本身
    create: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
    read: () => true,
    update: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: '租户名称',
    },
    {
      name: 'domain',
      type: 'text',
      label: '域名',
      admin: { description: '可选，用于前端路由区分' },
    },
    {
      name: 'slug',
      type: 'text',
      label: '短标识',
      required: true,
      unique: true,
      admin: { description: '唯一英文标识，如 acme-corp' },
    },
    {
      name: 'active',
      type: 'checkbox',
      label: '启用',
      defaultValue: true,
    },
  ],
}
