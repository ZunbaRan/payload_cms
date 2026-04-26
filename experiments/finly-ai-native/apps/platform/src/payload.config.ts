import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { aiPlugin } from '@finly/plugin-ai'
import { notesPlugin } from '@finly/plugin-notes'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' — Finly AI-Native' },
  },
  collections: [Users],
  plugins: [
    notesPlugin(),
    aiPlugin(),
    mcpPlugin({
      collections: {
        notes: { enabled: true, description: '笔记内容，支持 AI 标签和语义检索' },
        'token-usages': { enabled: { find: true }, description: 'AI Token 用量记录' },
      },
      globals: {
        'ai-config': { enabled: { find: true, update: true }, description: 'AI 模型和 Prompt 配置' },
      },
    }),
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./data.db' } }),
  sharp,
  jobs: {
    autoRun: [{ queue: 'default', cron: '*/30 * * * * *' }],
    shouldAutoRun: async () => process.env.NODE_ENV !== 'production',
  },
})
