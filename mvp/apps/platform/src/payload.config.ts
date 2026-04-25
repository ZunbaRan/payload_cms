import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { searchPlugin } from '@payloadcms/plugin-search'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Tenants } from './collections/Tenants'

import { contractPlugin, contractMcpTools } from '@mvp/plugin-contract'
import { notesPlugin } from '@mvp/plugin-notes'
import { tasksPlugin } from '@mvp/plugin-tasks'
import { documentsPlugin } from '@mvp/plugin-documents'

import { generateNoteTagsTask, processDocumentTask, dailyDigestTask } from './jobs/tasks'
import { customSearchEndpoint, customStatsEndpoint } from './endpoints/custom'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    components: { beforeDashboard: ['./components/BeforeDashboard.tsx'] },
    meta: { titleSuffix: ' — MVP Platform' },
  },
  collections: [Users, Media, Tenants],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || '' } }),
  sharp,
  endpoints: [customSearchEndpoint, customStatsEndpoint],
  jobs: {
    tasks: [generateNoteTagsTask, processDocumentTask, dailyDigestTask],
    autoRun: [{ queue: 'default', cron: '*/30 * * * * *' }],
    shouldAutoRun: async () => process.env.NODE_ENV !== 'production',
  },
  plugins: [
    contractPlugin(),
    notesPlugin(),
    tasksPlugin(),
    documentsPlugin(),
    searchPlugin({
      collections: ['notes', 'tasks', 'documents'],
      defaultPriorities: { notes: 20, tasks: 10, documents: 5 },
    }),
    seoPlugin({
      collections: ['notes'],
      uploadsCollection: 'media',
      generateTitle: ({ doc }: any) => `${doc?.title} — MVP Notes`,
      generateDescription: ({ doc }: any) =>
        (doc?.tags || []).join(', ') || 'AI auto-tagged note',
    }),
    nestedDocsPlugin({
      collections: ['notes'],
      generateLabel: (_, doc) => (doc as any)?.title as string,
      generateURL: (docs) =>
        docs.reduce((url, doc) => `${url}/${(doc as any)?.title}`, ''),
    }),
    mcpPlugin({
      collections: {
        contracts: { enabled: { find: true, create: true, update: true }, description: '企业合同管理' },
        notes: { enabled: { find: true, create: true, update: true }, description: '个人笔记（富文本、AI标签、树状层级）' },
        tasks: { enabled: { find: true, create: true, update: true }, description: '个人任务清单' },
        documents: { enabled: { find: true, create: false, update: false }, description: '上传文档（PDF/TXT/MD）由 Job 自动摘要' },
      },
      mcp: { tools: [...contractMcpTools] },
    }),
    // ─── P11 表单构建器 ──────────────────────────────────────────────────────────
    // 在 admin 里拖拽配置表单字段（text/email/select/checkbox/textarea 等），
    // 提交记录自动存入 form-submissions 集合，可配置邮件通知。
    // 演示：访问 /admin/collections/forms 创建一个"联系我们"表单
    formBuilderPlugin({
      fields: {
        text: true,
        email: true,
        select: true,
        textarea: true,
        checkbox: true,
        number: true,
        message: true,
        payment: false,   // 不演示支付
      },
      formOverrides: {
        admin: { group: '表单管理' },
      },
      formSubmissionOverrides: {
        admin: { group: '表单管理' },
      },
    }),
    // ─── P11 多租户 ──────────────────────────────────────────────────────────────
    // 给 collections 注入 tenant 关联字段，列表自动按租户过滤。
    // 演示：创建两个 Tenant（企业A/企业B），给用户分配租户后，
    //       notes/tasks 互不可见。
    multiTenantPlugin<any>({
      collections: {
        notes: {},
        tasks: {},
        contracts: {},
      },
      tenantsSlug: 'tenants',
      userHasAccessToAllTenants: (user: any) => user?.role === 'admin',
    }),
    // ─── P11 导入导出 ─────────────────────────────────────────────────────────────
    // 在每个集合的 admin 列表页右上角出现 Export / Import 按钮，
    // 支持 CSV 和 JSON 格式，可选导出字段。
    // 演示：导出 notes 为 CSV → 修改 → 导入回来（批量更新标题/tags）
    importExportPlugin({
      collections: [
        { slug: 'notes', format: 'csv' },
        { slug: 'contracts', format: 'csv' },
        { slug: 'tasks', format: 'json' },
      ],
    }),
  ],
})
