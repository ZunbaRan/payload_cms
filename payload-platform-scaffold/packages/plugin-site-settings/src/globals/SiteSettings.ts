import type { GlobalConfig } from 'payload'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  admin: { group: '系统设置' },
  access: {
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'site',
      type: 'group',
      label: '站点信息',
      fields: [
        { name: 'name', type: 'text', required: true, label: '站点名称' },
        { name: 'tagline', type: 'text', label: '副标题' },
        { name: 'description', type: 'textarea', label: '站点描述' },
        { name: 'url', type: 'text', label: '站点 URL' },
        { name: 'logo', type: 'upload', relationTo: 'images', label: 'Logo' },
        { name: 'favicon', type: 'upload', relationTo: 'images', label: 'Favicon' },
      ],
    },
    {
      name: 'theme',
      type: 'group',
      label: '主题',
      fields: [
        {
          name: 'mode',
          type: 'select',
          defaultValue: 'auto',
          options: [
            { label: '跟随系统', value: 'auto' },
            { label: '亮色', value: 'light' },
            { label: '暗色', value: 'dark' },
          ],
        },
        { name: 'primaryColor', type: 'text', defaultValue: '#3b82f6' },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO 默认值',
      fields: [
        { name: 'defaultMetaTitle', type: 'text' },
        { name: 'defaultMetaDescription', type: 'textarea' },
        { name: 'defaultOgImage', type: 'upload', relationTo: 'images' },
      ],
    },
    {
      name: 'security',
      type: 'group',
      label: '安全',
      fields: [
        { name: 'maxLoginAttempts', type: 'number', defaultValue: 5 },
        { name: 'lockoutMinutes', type: 'number', defaultValue: 15 },
        { name: 'sessionTimeoutMinutes', type: 'number', defaultValue: 120 },
      ],
    },
    {
      name: 'upload',
      type: 'group',
      label: '上传',
      fields: [
        { name: 'maxFileSizeMB', type: 'number', defaultValue: 10 },
        { name: 'allowedMimeTypes', type: 'text', hasMany: true },
      ],
    },
  ],
}
