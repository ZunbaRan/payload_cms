import type { TaskConfig } from 'payload'
import path from 'path'
import fs from 'fs/promises'
import { generateTags, classifyImportance, summarizeDocument } from '@mvp/shared/ai'
import { sendCard } from '@mvp/shared/feishu'
import { plainToLexical, lexicalToPlain } from '@mvp/shared/lexical'

/**
 * Job: 为笔记生成标签 + 判断重要性
 */
export const generateNoteTagsTask: TaskConfig<'generateNoteTags'> = {
  slug: 'generateNoteTags',
  retries: 2,
  inputSchema: [{ name: 'noteId', type: 'text', required: true }],
  outputSchema: [
    { name: 'tags', type: 'json' },
    { name: 'important', type: 'checkbox' },
  ],
  handler: async ({ input, req }) => {
    const note: any = await req.payload.findByID({
      collection: 'notes',
      id: input.noteId,
      depth: 0,
      overrideAccess: true,
    })

    const plainContent = lexicalToPlain(note.content) || ''

    const [tags, importance] = await Promise.all([
      note.tags && note.tags.length > 0
        ? Promise.resolve(note.tags as string[])
        : generateTags(note.title, plainContent),
      classifyImportance(note.title, plainContent),
    ])

    ;(req as any).__mvpNotesAIDone = true
    await req.payload.update({
      collection: 'notes',
      id: input.noteId,
      data: {
        tags,
        isImportant: importance.important,
        importanceReason: importance.reason,
        aiProcessed: true,
      },
      req,
      overrideAccess: true,
    })

    req.payload.logger.info(
      `[job:generateNoteTags] note=${input.noteId} tags=${tags.join(',')} important=${importance.important}`,
    )

    if (importance.important) {
      const base = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
      await sendCard({
        title: '🔔 发现重要笔记',
        color: 'orange',
        lines: [
          `**${note.title}**`,
          `**AI 理由**：${importance.reason || '(无)'}`,
          `**标签**：${tags.join(' / ') || '(无)'}`,
        ],
        linkText: '在 Admin 中查看',
        linkUrl: `${base}/admin/collections/notes/${input.noteId}`,
      })
    }

    return {
      output: { tags, important: importance.important },
    }
  },
}

/**
 * Job: 处理上传文档（PDF/TXT/MD），生成摘要并自动建笔记
 */
export const processDocumentTask: TaskConfig<'processDocument'> = {
  slug: 'processDocument',
  retries: 2,
  inputSchema: [{ name: 'documentId', type: 'text', required: true }],
  outputSchema: [
    { name: 'summary', type: 'text' },
    { name: 'noteId', type: 'text' },
  ],
  handler: async ({ input, req }) => {
    const doc: any = await req.payload.findByID({
      collection: 'documents',
      id: input.documentId,
      depth: 0,
      overrideAccess: true,
    })

    await req.payload.update({
      collection: 'documents',
      id: input.documentId,
      data: { status: 'processing' },
      req,
      overrideAccess: true,
    })

    try {
      const filePath = path.resolve(process.cwd(), 'uploads/documents', doc.filename)
      let text = ''
      if (doc.mimeType === 'application/pdf') {
        const pdfParseMod: any = await import('pdf-parse')
        const pdfParse = pdfParseMod.default || pdfParseMod
        const buffer = await fs.readFile(filePath)
        const result = await pdfParse(buffer)
        text = result.text || ''
      } else {
        text = await fs.readFile(filePath, 'utf-8')
      }
      if (!text.trim()) throw new Error('未提取到文本内容')

      const { summary, keywords } = await summarizeDocument(text)

      const note = await req.payload.create({
        collection: 'notes',
        data: {
          title: `[文档] ${doc.filename}`,
          content: plainToLexical(`${summary}\n\n---\n\n${text.slice(0, 2000)}`),
          tags: keywords,
          source: '由上传文档自动生成',
          relatedDocuments: [doc.id],
        } as any,
        req,
        overrideAccess: true,
      })

      await req.payload.update({
        collection: 'documents',
        id: input.documentId,
        data: {
          status: 'done',
          summary,
          keywords,
          relatedNote: note.id,
        },
        req,
        overrideAccess: true,
      })

      req.payload.logger.info(
        `[job:processDocument] doc=${input.documentId} → note=${note.id}`,
      )
      return { output: { summary, noteId: String(note.id) } }
    } catch (err) {
      const msg = (err as Error).message
      req.payload.logger.error(`[job:processDocument] failed: ${msg}`)
      await req.payload.update({
        collection: 'documents',
        id: input.documentId,
        data: { status: 'failed', error: msg.slice(0, 200) },
        req,
        overrideAccess: true,
      })
      throw err
    }
  },
}

/**
 * Job: 每日飞书日报（重要笔记 + 今日完成任务统计）
 * 由 schedule 自动触发
 */
export const dailyDigestTask: TaskConfig<'dailyDigest'> = {
  slug: 'dailyDigest',
  retries: 0,
  inputSchema: [],
  outputSchema: [{ name: 'sent', type: 'checkbox' }],
  handler: async ({ req }) => {
    const since = new Date()
    since.setHours(0, 0, 0, 0)

    const [important, doneTasks, newNotes] = await Promise.all([
      req.payload.count({
        collection: 'notes',
        where: { isImportant: { equals: true }, updatedAt: { greater_than: since.toISOString() } },
        overrideAccess: true,
      }),
      req.payload.count({
        collection: 'tasks',
        where: { status: { equals: 'done' }, updatedAt: { greater_than: since.toISOString() } },
        overrideAccess: true,
      }),
      req.payload.count({
        collection: 'notes',
        where: { createdAt: { greater_than: since.toISOString() } },
        overrideAccess: true,
      }),
    ])

    const base = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001'
    await sendCard({
      title: '📊 每日日报',
      color: 'blue',
      lines: [
        `**今日新增笔记**：${newNotes.totalDocs}`,
        `**今日标记重要**：${important.totalDocs}`,
        `**今日完成任务**：${doneTasks.totalDocs}`,
      ],
      linkText: '查看 Dashboard',
      linkUrl: `${base}/dashboard`,
    })
    req.payload.logger.info(
      `[job:dailyDigest] 已发送日报 notes=${newNotes.totalDocs} important=${important.totalDocs} done=${doneTasks.totalDocs}`,
    )

    return { output: { sent: true } }
  },
}
