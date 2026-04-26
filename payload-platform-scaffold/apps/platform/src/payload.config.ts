import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { examplePlugin } from '@scaffold/plugin-example'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' — Payload Platform' },
  },
  collections: [Users],
  plugins: [
    examplePlugin(),
    mcpPlugin({
      collections: {
        examples: {
          enabled: { find: true, create: true, update: true, delete: false },
          description: 'Example business records used by the scaffold template.',
        },
      },
      mcp: {
        serverOptions: {
          serverInfo: {
            name: 'Payload Platform MCP Server',
            version: '0.0.1',
          },
          instructions:
            'Use Payload MCP tools conservatively. Prefer read-only operations unless the user explicitly asks to create or update records.',
        },
      },
    }),
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./data.db' } }),
  sharp,
})
