import { ChromaClient, Collection } from 'chromadb'

let _client: ChromaClient | null = null
let _collection: Collection | null = null

function getClient(): ChromaClient {
  if (_client) return _client
  _client = new ChromaClient({ path: process.env.CHROMA_URL || 'http://localhost:8000' })
  return _client
}

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'finly-notes'

/**
 * 获取（或创建）Chroma Collection
 * Chroma 使用内置的 sentence-transformers embedding（all-MiniLM-L6-v2）
 * 如需自定义 embedding 函数，可传入 embeddingFunction 参数
 */
async function getCollection(): Promise<Collection> {
  if (_collection) return _collection
  const client = getClient()
  _collection = await client.getOrCreateCollection({ name: COLLECTION_NAME })
  return _collection
}

// ─── 写入 ──────────────────────────────────────────────────────────────────────

/**
 * 将笔记 upsert 到 Chroma
 * @param id        Payload 笔记 ID（字符串）
 * @param text      笔记正文（用于生成 embedding）
 * @param metadata  附加元数据（标题、标签等）
 */
export async function upsertNote(
  id: string,
  text: string,
  metadata: Record<string, string | number | boolean> = {},
): Promise<void> {
  const col = await getCollection()
  await col.upsert({
    ids: [id],
    documents: [text],
    metadatas: [metadata],
  })
}

/**
 * 从 Chroma 删除笔记（通常在 Payload afterDelete hook 里调用）
 */
export async function deleteNote(id: string): Promise<void> {
  const col = await getCollection()
  await col.delete({ ids: [id] })
}

// ─── 查询 ──────────────────────────────────────────────────────────────────────

export interface SemanticSearchResult {
  id: string
  distance: number
  metadata: Record<string, unknown>
  document: string
}

/**
 * 语义相似度搜索
 * @param query   搜索文本
 * @param topK    返回条数（默认 5）
 * @returns       按相似度排序的结果列表
 */
export async function semanticSearch(
  query: string,
  topK = 5,
): Promise<SemanticSearchResult[]> {
  const col = await getCollection()
  const results = await col.query({
    queryTexts: [query],
    nResults: topK,
  })

  const ids = results.ids[0] ?? []
  const distances = results.distances?.[0] ?? []
  const metadatas = results.metadatas?.[0] ?? []
  const documents = results.documents?.[0] ?? []

  return ids.map((id, i) => ({
    id,
    distance: distances[i] ?? 1,
    metadata: (metadatas[i] ?? {}) as Record<string, unknown>,
    document: documents[i] ?? '',
  }))
}
