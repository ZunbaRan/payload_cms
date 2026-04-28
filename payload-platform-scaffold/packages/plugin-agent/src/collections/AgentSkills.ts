import type { CollectionConfig } from 'payload'
import { extractSkillZip, removeSkillDir, getSkillDir } from '../lib/skillStorage'
import fs from 'node:fs'
import path from 'node:path'

/**
 * agent-skills
 *
 * 用户上传 zip → 后台解压 → 解析 SKILL.md frontmatter →
 *   - name / description / content 三个字段自动填充并 readOnly
 *   - 文件落在 .geoflow-data/agent-skills/<slug>/
 * 用户只能改 isActive（上架/下架），其他都不许改
 * 想改？删了重传
 */
export const AgentSkills: CollectionConfig = {
  slug: 'agent-skills',
  admin: {
    useAsTitle: 'name',
    group: 'AI Agent',
    defaultColumns: ['name', 'isActive', 'description', 'updatedAt'],
    description: '上传 SKILL.md zip 包，自动解析；想改请删除重传',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeValidate: [
      async ({ data, operation, req, originalDoc }) => {
        if (operation !== 'create') return data

        const file = req?.file as { data?: Buffer; name?: string } | undefined
        const zipBuf = file?.data
        if (!zipBuf) {
          throw new Error('请上传 SKILL.md zip 文件（POST 表单字段名: file）')
        }

        const slug = (data?.slug as string | undefined) || undefined
        const manifest = await extractSkillZip(zipBuf, slug)
        return {
          ...data,
          slug: manifest.slug,
          name: manifest.name,
          description: manifest.description,
          content: manifest.content,
          rawSkillMd: manifest.raw,
          files: manifest.files.map((p) => ({ path: p })),
          fileCount: manifest.files.length,
        }
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        const slug = (doc as { slug?: string }).slug
        if (slug) await removeSkillDir(slug)
      },
    ],
  },
  upload: {
    // 这里只是为了让 Payload admin 显示文件上传 UI；
    // 真正的处理在 beforeValidate hook 里
    mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    staticDir: path.resolve(process.cwd(), '.geoflow-data', 'agent-skill-uploads'),
  },
  fields: [
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: '上架',
      admin: {
        position: 'sidebar',
        description: '关闭即下架，不会删除文件，可重新上架',
      },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { readOnly: true, description: '从 SKILL.md 的 name 自动生成' },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Skill 名称',
      admin: {
        readOnly: true,
        description: '从 SKILL.md frontmatter `name` 字段读取，不可修改',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: '描述',
      admin: {
        readOnly: true,
        description: '从 SKILL.md frontmatter `description` 字段读取，不可修改',
      },
    },
    {
      name: 'content',
      type: 'code',
      label: 'SKILL.md 内容（去除 frontmatter）',
      admin: {
        readOnly: true,
        language: 'markdown',
        description: 'SKILL.md 正文，agent 使用时自动注入到上下文',
      },
    },
    {
      name: 'rawSkillMd',
      type: 'code',
      label: '完整 SKILL.md 原文',
      admin: {
        readOnly: true,
        language: 'markdown',
        condition: () => false, // 默认不展开
      },
    },
    {
      name: 'fileCount',
      type: 'number',
      admin: { readOnly: true, position: 'sidebar' },
      label: '文件数',
    },
    {
      name: 'files',
      type: 'array',
      label: '文件列表',
      admin: { readOnly: true },
      fields: [{ name: 'path', type: 'text' }],
    },
  ],
  endpoints: [
    {
      // GET /api/agent-skills/:id/files-info  返回磁盘上的实际文件列表（debug 用）
      path: '/:id/files-info',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const id = (req.routeParams as { id?: string } | undefined)?.id
        const doc = (await req.payload.findByID({
          collection: 'agent-skills',
          id: String(id),
          depth: 0,
        })) as { slug?: string }
        if (!doc?.slug) return Response.json({ error: 'not found' }, { status: 404 })
        const dir = getSkillDir(doc.slug)
        if (!fs.existsSync(dir)) return Response.json({ dir, exists: false, files: [] })
        const walk = (d: string, base = ''): string[] => {
          const out: string[] = []
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const rel = base ? `${base}/${entry.name}` : entry.name
            if (entry.isDirectory()) out.push(...walk(path.join(d, entry.name), rel))
            else out.push(rel)
          }
          return out
        }
        return Response.json({ dir, exists: true, files: walk(dir) })
      },
    },
  ],
}
