import type { CollectionConfig } from 'payload'
import path from 'node:path'

/**
 * kb-uploads
 * 知识库手动上传的源文件（.txt / .md / .json / .csv 等纯文本）。
 * 真正的「索引」由 indexKnowledgeBase 任务读取该文件内容写入 KB.rawContent。
 */
export const KbUploads: CollectionConfig = {
  slug: 'kb-uploads',
  admin: {
    useAsTitle: 'filename',
    group: '知识库',
    description: '上传 .txt / .md / .json / .csv 文件，作为知识库的源文件',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  upload: {
    mimeTypes: [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/octet-stream',
    ],
    staticDir: path.resolve(process.cwd(), '.geoflow-data', 'kb-uploads'),
  },
  fields: [
    { name: 'note', type: 'text', label: '备注' },
  ],
}
