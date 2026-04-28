/**
 * Skill 文件存储工具
 *
 * 磁盘布局：
 *   <root>/agent-skills/<skill-slug>/
 *       SKILL.md
 *       scripts/...
 *
 * 上传 zip → 解压 → 解析 SKILL.md frontmatter → 存到上面这个目录
 */
import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface SkillManifest {
  name: string
  description: string
  content: string // SKILL.md 去掉 frontmatter 后的正文
  files: string[] // 相对 SKILL 根目录的所有文件路径
  raw: string // 完整 SKILL.md 原文
}

/** 存储根目录 */
export function getSkillRoot(): string {
  return path.resolve(process.cwd(), '.geoflow-data', 'agent-skills')
}

/** 单个 skill 的目录 */
export function getSkillDir(slug: string): string {
  return path.join(getSkillRoot(), slug)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || `skill-${Date.now().toString(36)}`
}

/** 解析 SKILL.md 的 YAML frontmatter */
export function parseSkillMd(raw: string): { name?: string; description?: string; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return { body: raw }
  }
  try {
    const fm = parseYaml(m[1] || '') as { name?: string; description?: string }
    return {
      name: fm?.name,
      description: fm?.description,
      body: m[2] || '',
    }
  } catch {
    return { body: raw }
  }
}

/**
 * 解压 zip buffer 到 skill 目录，并解析 SKILL.md
 * 返回 manifest（name/description/content/files）
 */
export async function extractSkillZip(
  zipBuffer: Buffer,
  preferredSlug?: string,
): Promise<SkillManifest & { slug: string }> {
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries()

  // 找 SKILL.md（允许在根目录或第一层子目录里）
  let skillMdEntry = entries.find((e) => !e.isDirectory && e.entryName.toLowerCase() === 'skill.md')
  let stripPrefix = ''
  if (!skillMdEntry) {
    skillMdEntry = entries.find(
      (e) => !e.isDirectory && /^[^/]+\/skill\.md$/i.test(e.entryName),
    )
    if (skillMdEntry) {
      stripPrefix = skillMdEntry.entryName.split('/')[0] + '/'
    }
  }
  if (!skillMdEntry) {
    throw new Error('zip 包里找不到 SKILL.md（必须在根目录或第一层子目录）')
  }

  const raw = skillMdEntry.getData().toString('utf-8')
  const parsed = parseSkillMd(raw)
  if (!parsed.name) {
    throw new Error('SKILL.md frontmatter 缺少 name 字段')
  }

  const slug = slugify(preferredSlug || parsed.name)
  const dir = getSkillDir(slug)
  // 清空旧目录（如果有）
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
  await fs.mkdir(dir, { recursive: true })

  const files: string[] = []
  for (const e of entries) {
    if (e.isDirectory) continue
    let rel = e.entryName
    if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length)
    if (!rel) continue
    // 防穿越
    if (rel.includes('..')) continue
    const dest = path.join(dir, rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, e.getData())
    files.push(rel)
  }

  return {
    slug,
    name: parsed.name,
    description: parsed.description || '',
    content: parsed.body.trim(),
    raw,
    files,
  }
}

/** 删除 skill 目录（用于 afterDelete 钩子） */
export async function removeSkillDir(slug: string): Promise<void> {
  const dir = getSkillDir(slug)
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
