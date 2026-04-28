import type { CollectionAfterChangeHook } from 'payload'
import { getVectorStore } from '@scaffold/shared'

/**
 * KnowledgeBase.afterChange:
 * - 当 rawContent 变化时（或 syncStatus=pending）：
 *   1. 删除原有 chunks
 *   2. 按 chunkSize/chunkOverlap 切分 → 批量 create knowledge-chunks
 *   3. 把 syncStatus 置为 syncing；若配置了 embeddingModel + 该 model id，逐个入队 embedKnowledgeChunk
 *   4. 若没有 embeddingModel，则视为已同步（纯文本检索）
 *
 * 注意：使用 context._skip 防止 update chunkCount 时再触发。
 */
export const knowledgeBaseChunkHook: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  if (context?.skipChunk) return doc

  const rawChanged =
    !previousDoc ||
    (previousDoc as { rawContent?: string }).rawContent !==
      (doc as { rawContent?: string }).rawContent
  if (!rawChanged) return doc

  const payload = req.payload
  const id = (doc as { id: string | number }).id
  const rawContent = (doc as { rawContent?: string }).rawContent || ''
  const chunkSize = (doc as { chunkSize?: number }).chunkSize || 800
  const chunkOverlap = (doc as { chunkOverlap?: number }).chunkOverlap || 100
  const embeddingModelId = (doc as { embeddingModel?: string }).embeddingModel

  // 1. 清理旧 chunks
  const old = await payload.find({
    collection: 'knowledge-chunks',
    where: { knowledgeBase: { equals: id } },
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

  // 同步清理外部向量库（chroma/pgvector）
  try {
    const store = await getVectorStore({ payload })
    await store.deleteByKnowledgeBase(id)
  } catch (e) {
    req.payload.logger?.warn?.(`vector delete failed: ${(e as Error).message}`)
  }

  if (!rawContent.trim()) {
    await payload.update({
      collection: 'knowledge-bases',
      id,
      data: { chunkCount: 0, syncStatus: 'synced' } as never,
      depth: 0,
      overrideAccess: true,
      context: { skipChunk: true },
    })
    return doc
  }

  // 2. 切分
  const chunks: string[] = []
  const step = Math.max(1, chunkSize - chunkOverlap)
  for (let i = 0; i < rawContent.length; i += step) {
    chunks.push(rawContent.slice(i, i + chunkSize))
    if (i + chunkSize >= rawContent.length) break
  }

  // 3. 批量入库
  const created: { id: string | number }[] = []
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]
    const c = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        knowledgeBase: id,
        chunkIndex: i,
        content,
        preview: content.slice(0, 80),
      } as never,
      depth: 0,
      overrideAccess: true,
    })
    created.push(c)
  }

  await payload.update({
    collection: 'knowledge-bases',
    id,
    data: {
      chunkCount: created.length,
      syncStatus: embeddingModelId ? 'syncing' : 'synced',
      lastSyncedAt: new Date().toISOString(),
    } as never,
    depth: 0,
    overrideAccess: true,
    context: { skipChunk: true },
  })

  // 4. 入队 embedding（如果有模型）
  if (embeddingModelId) {
    for (const c of created) {
      await payload.jobs.queue({
        task: 'embedKnowledgeChunk',
        input: { chunkId: String(c.id), aiModelId: embeddingModelId },
      })
    }
  }

  return doc
}
