import type { TaskConfig } from 'payload'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getVectorStore } from '@scaffold/shared'

interface KbDoc {
  id: string | number
  rawContent?: string
  chunkSize?: number
  chunkOverlap?: number
  embeddingModel?: string | { id: string | number } | null
  sourceType?: string
  uploadedFile?: string | { id: string | number; filename?: string } | null
}

/**
 * indexKnowledgeBase
 *
 * 把 KB 切块 + 入队 embedding；记录到 kb-index-runs。
 * 流程：
 *   1. 标记 run = running, phase=chunking
 *   2. 如果 sourceType=file 且 uploadedFile 存在 → 从磁盘读文件写入 rawContent
 *   3. 删除旧 chunks（DB + 向量库）
 *   4. 切分 → 批量 create knowledge-chunks
 *   5. 若有 embeddingModel → 入队 embedKnowledgeChunk（携带 indexRunId） → 状态置 embedding
 *      否则直接 success
 */
export const indexKnowledgeBase: TaskConfig<'indexKnowledgeBase'> = {
  slug: 'indexKnowledgeBase',
  inputSchema: [
    { name: 'knowledgeBaseId', type: 'text', required: true },
    { name: 'indexRunId', type: 'text', required: true },
  ],
  outputSchema: [
    { name: 'totalChunks', type: 'number' },
    { name: 'queued', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const startedAt = new Date()
    const kbIdRaw = input.knowledgeBaseId
    const kbId = Number.isFinite(Number(kbIdRaw)) ? Number(kbIdRaw) : kbIdRaw
    const indexRunIdRaw = input.indexRunId
    const indexRunId = Number.isFinite(Number(indexRunIdRaw)) ? Number(indexRunIdRaw) : indexRunIdRaw

    const markRun = async (data: Record<string, unknown>) => {
      await payload.update({
        collection: 'kb-index-runs',
        id: indexRunId,
        data: data as never,
        depth: 0,
        overrideAccess: true,
      })
    }

    const markKb = async (data: Record<string, unknown>) => {
      await payload.update({
        collection: 'knowledge-bases',
        id: kbId,
        data: data as never,
        depth: 0,
        overrideAccess: true,
        context: { skipChunk: true },
      })
    }

    try {
      await markRun({ status: 'running', phase: 'chunking', startedAt: startedAt.toISOString() })
      await markKb({ syncStatus: 'syncing' })

      const kb = (await payload.findByID({
        collection: 'knowledge-bases',
        id: kbId,
        depth: 1,
      })) as unknown as KbDoc
      if (!kb) throw new Error('knowledge-base not found')

      // 2. file 来源 → 读文件
      let rawContent = kb.rawContent || ''
      if (kb.sourceType === 'file' && kb.uploadedFile) {
        const upId =
          typeof kb.uploadedFile === 'object' ? kb.uploadedFile.id : kb.uploadedFile
        const upDoc = (await payload.findByID({
          collection: 'kb-uploads',
          id: upId,
          depth: 0,
        })) as { filename?: string } | null
        const filename = upDoc?.filename
        if (!filename) throw new Error('上传文件没找到 filename')
        const fp = path.resolve(process.cwd(), '.geoflow-data', 'kb-uploads', filename)
        rawContent = await fs.readFile(fp, 'utf-8')
        await markKb({ rawContent })
      }

      if (!rawContent.trim()) {
        await markKb({ syncStatus: 'synced', chunkCount: 0, lastSyncedAt: new Date().toISOString() })
        const finished = new Date()
        await markRun({
          status: 'success',
          phase: 'done',
          progress: 100,
          totalChunks: 0,
          embeddedChunks: 0,
          finishedAt: finished.toISOString(),
          durationMs: finished.getTime() - startedAt.getTime(),
          message: '原始内容为空，跳过',
        })
        return { output: { totalChunks: 0, queued: 0 } }
      }

      // 3. 清理旧 chunks
      const old = await payload.find({
        collection: 'knowledge-chunks',
        where: { knowledgeBase: { equals: kbId } },
        limit: 10000,
        depth: 0,
      })
      await Promise.all(
        old.docs.map((c: { id: string | number }) =>
          payload.delete({
            collection: 'knowledge-chunks',
            id: c.id,
            depth: 0,
            overrideAccess: true,
          }),
        ),
      )
      try {
        const store = await getVectorStore({ payload })
        await store.deleteByKnowledgeBase(kbId)
      } catch (e) {
        payload.logger?.warn?.(`vector delete failed: ${(e as Error).message}`)
      }

      // 4. 切分
      const chunkSize = kb.chunkSize || 800
      const chunkOverlap = kb.chunkOverlap || 100
      const step = Math.max(1, chunkSize - chunkOverlap)
      const chunks: string[] = []
      for (let i = 0; i < rawContent.length; i += step) {
        chunks.push(rawContent.slice(i, i + chunkSize))
        if (i + chunkSize >= rawContent.length) break
      }

      const created: { id: string | number }[] = []
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i]
        const c = await payload.create({
          collection: 'knowledge-chunks',
          data: {
            knowledgeBase: kbId,
            chunkIndex: i,
            content,
            preview: content.slice(0, 80),
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        created.push(c)
      }

      const embeddingModelId =
        typeof kb.embeddingModel === 'object' && kb.embeddingModel
          ? kb.embeddingModel.id
          : kb.embeddingModel

      // 5. 入队 embedding
      if (embeddingModelId && created.length > 0) {
        await markRun({
          phase: 'embedding',
          totalChunks: created.length,
          embeddedChunks: 0,
          progress: 5,
        })
        await markKb({ chunkCount: created.length })

        for (const c of created) {
          await payload.jobs.queue({
            task: 'embedKnowledgeChunk',
            input: {
              chunkId: String(c.id),
              aiModelId: String(embeddingModelId),
              indexRunId: String(indexRunId),
            },
          })
        }
        return { output: { totalChunks: created.length, queued: created.length } }
      }

      // 没有 embedding 模型 → 直接完成
      const finished = new Date()
      await markKb({
        chunkCount: created.length,
        syncStatus: 'synced',
        lastSyncedAt: finished.toISOString(),
      })
      await markRun({
        status: 'success',
        phase: 'done',
        totalChunks: created.length,
        embeddedChunks: 0,
        progress: 100,
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - startedAt.getTime(),
        message: '未配置 embedding 模型，仅完成切块',
      })
      return { output: { totalChunks: created.length, queued: 0 } }
    } catch (e) {
      const finished = new Date()
      await markRun({
        status: 'failed',
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - startedAt.getTime(),
        message: (e as Error).message || String(e),
      })
      await markKb({ syncStatus: 'failed' })
      throw e
    }
  },
}
