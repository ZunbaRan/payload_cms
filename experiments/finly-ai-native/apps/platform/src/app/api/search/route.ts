import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { semanticSearch } from '@finly/shared/chroma'

/**
 * 语义搜索 API
 * GET /api/search?q=查询词&topK=5
 *
 * 1. 在 Chroma 做语义相似度搜索，拿到笔记 ID 列表
 * 2. 从 Payload 查出完整笔记数据返回
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  const topK = Number(req.nextUrl.searchParams.get('topK') || '5')

  if (!query) {
    return NextResponse.json({ error: '缺少查询参数 q' }, { status: 400 })
  }

  const payload = await getPayload({ config })

  // 向量语义搜索
  const chromaResults = await semanticSearch(query, topK)

  if (chromaResults.length === 0) {
    return NextResponse.json({ results: [], total: 0 })
  }

  // 从 Payload 拉取完整数据
  const noteIds = chromaResults.map((r) => r.id)
  const { docs } = await payload.find({
    collection: 'notes',
    where: { id: { in: noteIds } },
    overrideAccess: true,
    depth: 0,
  })

  // 按向量相似度排序
  const idToDistance = Object.fromEntries(chromaResults.map((r) => [r.id, r.distance]))
  const sorted = docs.sort((a, b) => {
    return (idToDistance[String(a.id)] ?? 1) - (idToDistance[String(b.id)] ?? 1)
  })

  return NextResponse.json({
    results: sorted.map((note) => ({
      id: note.id,
      title: (note as any).title,
      tags: (note as any).tags,
      isImportant: (note as any).isImportant,
      distance: idToDistance[String(note.id)],
    })),
    total: sorted.length,
  })
}
