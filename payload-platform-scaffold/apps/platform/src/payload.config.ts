import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { aiEnginePlugin } from '@scaffold/plugin-ai-engine'
import { agentPlugin } from '@scaffold/plugin-agent'
import { contentPlugin } from '@scaffold/plugin-content'
import { knowledgeBasePlugin } from '@scaffold/plugin-knowledge-base'
import { materialsPlugin } from '@scaffold/plugin-materials'
import { moderationPlugin } from '@scaffold/plugin-moderation'
import { siteSettingsPlugin } from '@scaffold/plugin-site-settings'
import { tasksPlugin } from '@scaffold/plugin-tasks'
import { urlImportPlugin } from '@scaffold/plugin-url-import'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

import { Users } from './collections/Users'
import { seedDefaultAiModels } from './seed'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const requireCjs = createRequire(import.meta.url)

/**
 * 数据库驱动切换：
 *   DB_DRIVER=sqlite    （默认，dev）
 *   DB_DRIVER=postgres  （prod，需要 @payloadcms/db-postgres + DATABASE_URL）
 */
function buildDb(): any {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase()
  if (driver === 'postgres' || driver === 'pg') {
    // 用变量名拼接，避免 Turbopack/Next 在 dev 模式静态解析这个可选依赖。
    // 仅在 DB_DRIVER=postgres 时才需要安装 @payloadcms/db-postgres。
    const pkg = ['@payloadcms', 'db-postgres'].join('/')
    const mod = requireCjs(pkg) as {
      postgresAdapter: (cfg: { pool: { connectionString: string } }) => any
    }
    return mod.postgresAdapter({
      pool: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgres://postgres:postgres@localhost:5432/geoflow',
      },
    })
  }
  return sqliteAdapter({
    client: { url: process.env.DATABASE_URL || 'file:./data.db' },
  })
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' — GEOFlow on Payload' },
  },
  collections: [Users],
  plugins: [
    // 业务插件按依赖顺序加载
    materialsPlugin(),
    knowledgeBasePlugin(),
    aiEnginePlugin(),
    contentPlugin(),
    tasksPlugin(),
    agentPlugin(),
    moderationPlugin(),
    urlImportPlugin(),
    siteSettingsPlugin(),
    // MCP 暴露给 AI Agent 的能力（只暴露读 + 关键写，删除一律拒绝）
    mcpPlugin({
      collections: {
        articles: {
          enabled: { find: true, create: true, update: true, delete: false },
          description: 'GEO 文章主体：标题、正文、状态、SEO 元数据。',
        },
        tasks: {
          enabled: { find: true, create: true, update: true, delete: false },
          description: '内容生成任务编排：库选择、模型、Prompt、节奏。',
        },
        prompts: {
          enabled: { find: true, create: true, update: true, delete: false },
          description: 'Prompt 模板库；AI Agent 可读取已有模板辅助生成。',
        },
        'knowledge-bases': {
          enabled: { find: true, create: false, update: false, delete: false },
          description: 'RAG 知识库元信息（只读，避免 Agent 误删）。',
        },
        titles: {
          enabled: { find: true, create: true, update: true, delete: false },
        },
        keywords: {
          enabled: { find: true, create: true, update: true, delete: false },
        },
        categories: {
          enabled: { find: true, create: false, update: false, delete: false },
        },
      },
      mcp: {
        serverOptions: {
          serverInfo: {
            name: 'GEOFlow Payload MCP Server',
            version: '0.0.1',
          },
          instructions:
            'GEOFlow 是 GEO 内容工程平台。优先读取 articles / tasks / prompts；写入需谨慎，删除一律拒绝。',
        },
      },
    }),
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: buildDb(),
  jobs: {
    // 开发模式自动 tick 一次队列；生产请用独立 worker 进程
    autoRun: [
      {
        cron: '* * * * *',
        limit: 10,
        queue: 'default',
      },
    ],
    shouldAutoRun: () => process.env.JOBS_AUTORUN !== 'false',
  },
  onInit: async (payload: any) => {
    await seedDefaultAiModels(payload)
  },
  sharp,
})
