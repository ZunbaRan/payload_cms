/**
 * GEOFlow → Payload 数据迁移脚本（骨架）
 *
 * 用法：
 *   GEOFLOW_DB_URL=postgres://user:pass@host:5432/geoflow \
 *   pnpm migrate:geoflow [--only=titles,keywords,...] [--dry-run]
 *
 * 支持的步骤（按依赖顺序）：
 *   users → authors → categories → title-libraries → titles
 *     → keyword-libraries → keywords → image-libraries → images
 *     → ai-models → prompts → tasks → articles → knowledge-bases
 *     → knowledge-chunks → sensitive-words → site-settings
 *
 * 注意：本脚本只是骨架/示例。具体字段映射需根据实际 GEOFlow schema 微调。
 */

import 'dotenv/config'
import config from '../src/payload.config'
import { getPayload } from 'payload'
import { htmlToLexical } from '@scaffold/shared'

interface MigrationContext {
  payload: any
  dryRun: boolean
  // 保存源 -> 目标的 id 映射，便于关系外键转换
  idMap: Map<string, Map<string | number, string | number>>
}

const STEPS: Array<{ name: string; run: (ctx: MigrationContext) => Promise<void> }> = [
  { name: 'authors', run: migrateAuthors },
  { name: 'categories', run: migrateCategories },
  { name: 'title-libraries', run: migrateTitleLibraries },
  { name: 'titles', run: migrateTitles },
  { name: 'articles', run: migrateArticles },
  // 其余步骤同理：keyword-libraries / keywords / image-libraries / images
  // / ai-models / prompts / tasks / knowledge-bases / knowledge-chunks
  // / sensitive-words / site-settings
]

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const payload = await getPayload({ config })
  const ctx: MigrationContext = {
    payload,
    dryRun: args.dryRun,
    idMap: new Map(),
  }

  const stepsToRun = args.only ? STEPS.filter((s) => args.only!.includes(s.name)) : STEPS

  for (const step of stepsToRun) {
    console.log(`\n▶︎ Migrating: ${step.name}${ctx.dryRun ? ' [DRY-RUN]' : ''}`)
    try {
      await step.run(ctx)
    } catch (e) {
      console.error(`  ✗ ${step.name} failed:`, e)
      throw e
    }
  }

  console.log('\n✅ Migration finished.')
  process.exit(0)
}

// ============ steps ============

async function migrateAuthors(ctx: MigrationContext) {
  // TODO: 替换为真实数据源（例如 pg.query('SELECT * FROM authors')）
  const sourceRows = await fetchFromGeoFlow('authors')
  const map = new Map<string | number, string | number>()
  for (const row of sourceRows) {
    if (ctx.dryRun) {
      console.log('  [dry] would create author', row.name)
      continue
    }
    const created = await ctx.payload.create({
      collection: 'authors',
      data: {
        name: row.name,
        bio: row.bio,
        avatar: row.avatar_url,
        externalId: row.id,
      } as never,
      overrideAccess: true,
    })
    map.set(row.id, created.id)
  }
  ctx.idMap.set('authors', map)
  console.log(`  ✓ migrated ${map.size} authors`)
}

async function migrateCategories(ctx: MigrationContext) {
  const rows = await fetchFromGeoFlow('categories')
  const map = new Map<string | number, string | number>()

  // 先建无父级的，再处理带父级的，避免循环
  const sorted = rows.slice().sort((a: any, b: any) => (a.parent_id ? 1 : -1) - (b.parent_id ? 1 : -1))
  for (const row of sorted) {
    if (ctx.dryRun) {
      console.log('  [dry] would create category', row.name)
      continue
    }
    const created = await ctx.payload.create({
      collection: 'categories',
      data: {
        name: row.name,
        slug: row.slug,
        parent: row.parent_id ? map.get(row.parent_id) : undefined,
      } as never,
      overrideAccess: true,
    })
    map.set(row.id, created.id)
  }
  ctx.idMap.set('categories', map)
  console.log(`  ✓ migrated ${map.size} categories`)
}

async function migrateTitleLibraries(ctx: MigrationContext) {
  const rows = await fetchFromGeoFlow('title_libraries')
  const map = new Map<string | number, string | number>()
  for (const row of rows) {
    if (ctx.dryRun) continue
    const created = await ctx.payload.create({
      collection: 'title-libraries',
      data: { name: row.name, description: row.description } as never,
      overrideAccess: true,
    })
    map.set(row.id, created.id)
  }
  ctx.idMap.set('title-libraries', map)
  console.log(`  ✓ migrated ${map.size} title-libraries`)
}

async function migrateTitles(ctx: MigrationContext) {
  const rows = await fetchFromGeoFlow('titles')
  const libMap = ctx.idMap.get('title-libraries') || new Map()
  let n = 0
  for (const row of rows) {
    if (ctx.dryRun) continue
    await ctx.payload.create({
      collection: 'titles',
      data: {
        text: row.text,
        library: libMap.get(row.library_id),
        status: row.status || 'pending',
      } as never,
      overrideAccess: true,
    })
    n++
  }
  console.log(`  ✓ migrated ${n} titles`)
}

async function migrateArticles(ctx: MigrationContext) {
  const rows = await fetchFromGeoFlow('articles')
  const authorMap = ctx.idMap.get('authors') || new Map()
  const catMap = ctx.idMap.get('categories') || new Map()
  let n = 0
  for (const row of rows) {
    if (ctx.dryRun) continue
    await ctx.payload.create({
      collection: 'articles',
      data: {
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        content: htmlToLexical(row.content_html || ''),
        status: row.status || 'draft',
        author: authorMap.get(row.author_id),
        category: catMap.get(row.category_id),
        publishedAt: row.published_at,
      } as never,
      overrideAccess: true,
    })
    n++
  }
  console.log(`  ✓ migrated ${n} articles`)
}

// ============ helpers ============

/**
 * TODO: 接入真实的 GEOFlow 数据源。
 * 示例实现：用 pg 库连 PostgreSQL；或从导出的 JSON 文件读取。
 *
 *   import { Client } from 'pg'
 *   const pg = new Client({ connectionString: process.env.GEOFLOW_DB_URL })
 *   await pg.connect()
 *   const r = await pg.query(`SELECT * FROM ${table}`)
 *   return r.rows
 */
async function fetchFromGeoFlow(table: string): Promise<any[]> {
  console.warn(`  ⚠ fetchFromGeoFlow('${table}') 尚未实现，返回空数组`)
  return []
}

function parseArgs(args: string[]) {
  const out = { dryRun: false, only: undefined as string[] | undefined }
  for (const a of args) {
    if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length).split(',')
  }
  return out
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
