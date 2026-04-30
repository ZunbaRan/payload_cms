/**
 * 一次性脚本：从已加载的 Payload config 中导出所有 collection 的字段定义，
 * 生成 REST API 参考文档 (Markdown)。
 *
 * 用法：pnpm --filter platform exec tsx scripts/dump-api-docs.ts
 */
import { getPayload } from 'payload'
import config from '../src/payload.config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function fieldRow(f: any, prefix = ''): string[] {
  const rows: string[] = []
  const name = f.name ? `${prefix}${f.name}` : `${prefix}(${f.type})`
  if (f.type === 'tabs') {
    for (const tab of f.tabs || []) {
      for (const sub of tab.fields || []) rows.push(...fieldRow(sub, prefix))
    }
    return rows
  }
  if (f.type === 'row' || f.type === 'collapsible') {
    for (const sub of f.fields || []) rows.push(...fieldRow(sub, prefix))
    return rows
  }
  if (!f.name) return rows
  const t = f.type
  const required = f.required ? '✓' : ''
  const localized = f.localized ? '✓' : ''
  const unique = f.unique ? '✓' : ''
  const idx = f.index ? '✓' : ''
  let extra = ''
  if (t === 'relationship' || t === 'upload') {
    extra = `→ ${Array.isArray(f.relationTo) ? f.relationTo.join('|') : f.relationTo}${f.hasMany ? ' (hasMany)' : ''}`
  } else if (t === 'select' || t === 'radio') {
    extra = (f.options || [])
      .map((o: any) => (typeof o === 'string' ? o : o.value))
      .slice(0, 8)
      .join(' / ')
    if ((f.options || []).length > 8) extra += ' …'
    if (f.hasMany) extra = `[${extra}] (hasMany)`
  } else if (t === 'array' || t === 'group') {
    extra = `{ ${(f.fields || []).map((s: any) => s.name).filter(Boolean).join(', ')} }`
  } else if (t === 'blocks') {
    extra = (f.blocks || []).map((b: any) => b.slug).join(' | ')
  }
  rows.push(
    `| \`${name}\` | ${t} | ${required} | ${localized} | ${unique} | ${idx} | ${extra.replace(/\|/g, '\\|')} |`,
  )
  if (t === 'array' || t === 'group') {
    for (const sub of f.fields || []) rows.push(...fieldRow(sub, `${name}.`))
  }
  return rows
}

async function main() {
  const payload = await getPayload({ config })
  const cfg: any = payload.config
  const lines: string[] = []
  lines.push('# Payload REST API 参考')
  lines.push('')
  lines.push(`> 自动生成于 ${new Date().toISOString()}（基于运行时 \`payload.config\`）`)
  lines.push('')
  lines.push(`Base URL: \`${cfg.serverURL || 'http://localhost:3000'}${cfg.routes.api}\``)
  lines.push('')
  lines.push('## 鉴权')
  lines.push('')
  lines.push('Payload 默认接受 3 种凭证（顺序见 `auth.jwtOrder`）：')
  lines.push('- HTTP Header：`Authorization: JWT <token>`')
  lines.push('- HTTP Header：`Authorization: Bearer <token>`（仅 API Key 启用时）')
  lines.push('- Cookie：`payload-token`（admin 登录后自动写入）')
  lines.push('')
  lines.push('登录获取 token：')
  lines.push('```bash')
  lines.push(`curl -X POST '${cfg.serverURL || 'http://localhost:3000'}${cfg.routes.api}/${cfg.admin?.user || 'users'}/login' \\`)
  lines.push("  -H 'Content-Type: application/json' \\")
  lines.push("  -d '{\"email\":\"admin@test.com\",\"password\":\"...\"}'")
  lines.push('```')
  lines.push('')
  lines.push('## 通用查询参数')
  lines.push('')
  lines.push('适用于所有 collection 的 `find` 端点（GET `/api/<slug>`）：')
  lines.push('')
  lines.push('| 参数 | 类型 | 说明 |')
  lines.push('|------|------|------|')
  lines.push('| `where` | object | 过滤条件，支持 `equals`, `not_equals`, `in`, `not_in`, `like`, `contains`, `greater_than`, `less_than`, `exists`, `near`, `and`, `or`。例：`?where[status][equals]=published` |')
  lines.push('| `sort` | string | 排序字段，前缀 `-` 表示倒序，逗号分隔多字段。例：`?sort=-createdAt` |')
  lines.push('| `limit` | number | 单页条数；`0` 表示返回全部（不分页） |')
  lines.push('| `page` | number | 页码（1 起） |')
  lines.push('| `depth` | number | 关系字段递归展开深度，默认 `' + (cfg.defaultDepth ?? 2) + '`，最大 `' + (cfg.maxDepth ?? 10) + '` |')
  lines.push('| `select` | object | 仅返回指定字段。例：`?select[title]=true&select[slug]=true` |')
  lines.push('| `populate` | object | 关系字段中精细选择展开字段 |')
  lines.push('| `locale` | string | 本地化区域码；启用 localization 时生效 |')
  lines.push('| `fallback-locale` | string | 回退区域码 |')
  lines.push('| `draft` | boolean | 启用版本草稿时拉取草稿 |')
  lines.push('| `trash` | boolean | 启用 trash 时返回回收站记录 |')
  lines.push('')
  lines.push('## 标准端点（每个 collection）')
  lines.push('')
  lines.push('| Method | Path | 用途 |')
  lines.push('|--------|------|------|')
  lines.push('| GET    | `/api/<slug>` | 列表查询（find） |')
  lines.push('| POST   | `/api/<slug>` | 创建文档（create） |')
  lines.push('| GET    | `/api/<slug>/:id` | 获取单条（findByID） |')
  lines.push('| PATCH  | `/api/<slug>/:id` | 更新（update） |')
  lines.push('| DELETE | `/api/<slug>/:id` | 删除（delete） |')
  lines.push('| POST   | `/api/<slug>/:id/duplicate` | 复制 |')
  lines.push('| GET    | `/api/<slug>/count` | 统计 |')
  lines.push('| GET    | `/api/<slug>/versions` | 版本列表（启用 versions 时） |')
  lines.push('| GET    | `/api/<slug>/versions/:id` | 单个版本 |')
  lines.push('| POST   | `/api/<slug>/versions/:id` | 恢复版本 |')
  lines.push('')
  lines.push('## Auth 端点（启用 `auth: true` 的 collection）')
  lines.push('')
  lines.push('| Method | Path | 用途 |')
  lines.push('|--------|------|------|')
  lines.push('| POST   | `/api/<slug>/login` | 登录 |')
  lines.push('| POST   | `/api/<slug>/logout` | 登出 |')
  lines.push('| GET    | `/api/<slug>/me` | 当前用户 |')
  lines.push('| POST   | `/api/<slug>/refresh-token` | 刷新 token |')
  lines.push('| POST   | `/api/<slug>/forgot-password` | 忘记密码 |')
  lines.push('| POST   | `/api/<slug>/reset-password` | 重置密码 |')
  lines.push('| POST   | `/api/<slug>/unlock` | 解锁账号 |')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('# Collections 目录')
  lines.push('')
  for (const c of cfg.collections) {
    const labels = (c.labels?.singular && (typeof c.labels.singular === 'string' ? c.labels.singular : c.labels.singular.zh || c.labels.singular.en)) || c.slug
    lines.push(`- [\`${c.slug}\`](#${c.slug}) — ${labels}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const c of cfg.collections) {
    const labels = (c.labels?.singular && (typeof c.labels.singular === 'string' ? c.labels.singular : c.labels.singular.zh || c.labels.singular.en)) || c.slug
    lines.push(`## \`${c.slug}\``)
    lines.push('')
    lines.push(`**标签**：${labels}`)
    if (c.admin?.description) {
      const desc = typeof c.admin.description === 'string' ? c.admin.description : c.admin.description.zh || c.admin.description.en || ''
      if (desc) lines.push(`> ${desc}`)
    }
    lines.push('')
    const flags: string[] = []
    if (c.auth) flags.push('auth')
    if (c.upload) flags.push('upload')
    if (c.versions) flags.push('versions' + (c.versions?.drafts ? ' (drafts)' : ''))
    if (c.trash) flags.push('trash')
    if (flags.length) lines.push(`**特性**：${flags.join(' · ')}`)
    lines.push('')
    lines.push(`**端点基址**：\`${cfg.routes.api}/${c.slug}\``)
    lines.push('')
    lines.push('### 字段')
    lines.push('')
    lines.push('| 字段 | 类型 | required | localized | unique | index | 备注 |')
    lines.push('|------|------|:-:|:-:|:-:|:-:|------|')
    // 内置字段
    lines.push('| `id` | ' + (cfg.db?.defaultIDType === 'number' ? 'number' : 'number/string') + ' | ✓ |  |  | ✓ | 自动生成 |')
    for (const f of c.fields || []) {
      const rs = fieldRow(f)
      for (const r of rs) lines.push(r)
    }
    if (c.timestamps !== false) {
      lines.push('| `createdAt` | date | ✓ |  |  | ✓ | 自动 |')
      lines.push('| `updatedAt` | date | ✓ |  |  | ✓ | 自动 |')
    }
    lines.push('')
    if (c.upload) {
      lines.push('### Upload 端点（multipart/form-data）')
      lines.push('')
      lines.push(`- POST \`${cfg.routes.api}/${c.slug}\` — 上传文件，字段名 \`file\``)
      lines.push(`- GET \`${cfg.routes.api}/${c.slug}/file/:filename\` — 原图`)
      const sizes = (c.upload as any)?.imageSizes
      if (Array.isArray(sizes) && sizes.length) {
        lines.push('- 图片尺寸：' + sizes.map((s: any) => `\`${s.name}\` (${s.width}×${s.height})`).join(' · '))
      }
      lines.push('')
    }
    if (c.auth) {
      lines.push('### Auth 端点（在通用 Auth 端点之上启用）')
      lines.push('')
      lines.push(`- POST \`${cfg.routes.api}/${c.slug}/login\``)
      lines.push(`- GET \`${cfg.routes.api}/${c.slug}/me\``)
      lines.push('')
    }
    if (Array.isArray(c.endpoints) && c.endpoints.length) {
      lines.push('### 自定义端点')
      lines.push('')
      lines.push('| Method | Path | 说明 |')
      lines.push('|--------|------|------|')
      for (const ep of c.endpoints) {
        const method = (ep.method || 'get').toUpperCase()
        lines.push(`| ${method} | \`${cfg.routes.api}/${c.slug}${ep.path}\` | ${ep.custom?.description || ''} |`)
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  // Globals
  if (cfg.globals?.length) {
    lines.push('# Globals')
    lines.push('')
    for (const g of cfg.globals) {
      lines.push(`## \`${g.slug}\` (global)`)
      lines.push('')
      lines.push(`- GET \`${cfg.routes.api}/globals/${g.slug}\``)
      lines.push(`- POST \`${cfg.routes.api}/globals/${g.slug}\``)
      lines.push('')
      lines.push('| 字段 | 类型 | required | localized |')
      lines.push('|------|------|:-:|:-:|')
      for (const f of g.fields || []) {
        for (const r of fieldRow(f)) {
          // 改造行：只取前 4 列
          const cols = r.split(' | ')
          lines.push([cols[0], cols[1], cols[2], cols[3]].join(' | ') + ' |')
        }
      }
      lines.push('')
    }
  }

  // Top-level custom endpoints
  if (Array.isArray(cfg.endpoints) && cfg.endpoints.length) {
    lines.push('# 顶层自定义端点')
    lines.push('')
    lines.push('| Method | Path | 说明 |')
    lines.push('|--------|------|------|')
    for (const ep of cfg.endpoints) {
      const method = (ep.method || 'get').toUpperCase()
      lines.push(`| ${method} | \`${cfg.routes.api}${ep.path}\` | ${ep.custom?.description || ''} |`)
    }
    lines.push('')
  }

  const out = path.resolve(__dirname, '../../../../notes/api-reference.md')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, lines.join('\n'), 'utf8')
  console.log('wrote', out, '(' + lines.length + ' lines)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
