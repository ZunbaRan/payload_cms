/**
 * 向量库抽象层
 *
 * 设计原则：把 DB + 向量库都抽象出接口，让 dev/prod 各自有默认实现，
 * 但保留可扩展性（未来想接 milvus / weaviate / qdrant，加个实现即可）。
 *
 * 内置 2 个实现：
 *   - 'sqlite' (== 'local')  默认 dev：向量直接落入 Payload 的 SQLite 表
 *                            (knowledge-chunks.embedding JSON)，零外部依赖。
 *   - 'pgvector'             默认 prod：复用 Payload 的 PostgreSQL，pgvector 扩展。
 *
 * 选择由环境变量决定：
 *   VECTOR_STORE=sqlite|pgvector   未设置 → 根据 DB_DRIVER 推断
 *     - DB_DRIVER=postgres → pgvector
 *     - 否则               → sqlite
 *   PGVECTOR_TABLE=knowledge_vectors   表名
 *   PGVECTOR_DIM=384                    向量维度（与 embedding 模型对齐）
 */

export interface VectorRecord {
  id: string
  vector: number[]
  payload: {
    knowledgeBaseId: string | number
    chunkIndex?: number
    content?: string
    [k: string]: unknown
  }
}

export interface VectorQueryFilter {
  knowledgeBaseId?: string | number
}

export interface VectorQueryHit {
  id: string
  score: number
  payload: VectorRecord['payload']
}

export interface VectorStore {
  readonly kind: 'sqlite' | 'pgvector'
  init(): Promise<void>
  upsert(records: VectorRecord[]): Promise<void>
  deleteByKnowledgeBase(knowledgeBaseId: string | number): Promise<void>
  query(vector: number[], topK: number, filter?: VectorQueryFilter): Promise<VectorQueryHit[]>
}

export type VectorStoreKind = 'sqlite' | 'local' | 'pgvector'

export interface VectorStoreFactoryDeps {
  /** sqlite 后端需要 payload 实例 */
  payload?: any
}

let cached: VectorStore | undefined

/** 单例工厂，自动根据 env 推断 */
export async function getVectorStore(
  deps: VectorStoreFactoryDeps = {},
): Promise<VectorStore> {
  if (cached) return cached
  const explicit = (process.env.VECTOR_STORE || '').toLowerCase() as VectorStoreKind | ''
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase()
  const kind: VectorStoreKind = explicit || (driver === 'postgres' ? 'pgvector' : 'sqlite')
  cached = await createVectorStore(kind, deps)
  await cached.init()
  return cached
}

export async function createVectorStore(
  kind: VectorStoreKind,
  deps: VectorStoreFactoryDeps = {},
): Promise<VectorStore> {
  switch (kind) {
    case 'pgvector':
      return new PgVectorStore({
        url: process.env.PGVECTOR_URL || process.env.DATABASE_URL || '',
        table: process.env.PGVECTOR_TABLE || 'knowledge_vectors',
        dim: Number(process.env.PGVECTOR_DIM || 384),
      })
    case 'local':
    case 'sqlite':
    default:
      if (!deps.payload) {
        throw new Error('VectorStore kind=sqlite 需要 deps.payload')
      }
      return new SqliteVectorStore(deps.payload)
  }
}

// ============ SQLite 嵌入式实现（默认 dev） ============
// 直接把向量塞进 knowledge-chunks.embedding 字段（JSON），查询时全表余弦。
// 适合 dev / 万级以内的数据。

class SqliteVectorStore implements VectorStore {
  readonly kind = 'sqlite' as const
  constructor(private payload: any) {}
  async init(): Promise<void> {}
  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) {
      await this.payload.update({
        collection: 'knowledge-chunks',
        id: r.id,
        data: { embedding: r.vector } as never,
        depth: 0,
        overrideAccess: true,
      })
    }
  }
  async deleteByKnowledgeBase(): Promise<void> {
    // chunks 删除走 KB hook，无需此处处理
  }
  async query(
    vector: number[],
    topK: number,
    filter: VectorQueryFilter = {},
  ): Promise<VectorQueryHit[]> {
    const where: Record<string, unknown> = { embedding: { exists: true } }
    if (filter.knowledgeBaseId !== undefined) {
      where.knowledgeBase = { equals: filter.knowledgeBaseId }
    }
    const { docs } = await this.payload.find({
      collection: 'knowledge-chunks',
      where,
      limit: 1000,
      depth: 0,
    })
    return (
      docs as Array<{
        id: string | number
        knowledgeBase: unknown
        embedding: number[]
        content: string
        chunkIndex?: number
      }>
    )
      .map((d) => ({
        id: String(d.id),
        score: cosine(vector, d.embedding || []),
        payload: {
          knowledgeBaseId: extractId(d.knowledgeBase) ?? '',
          content: d.content,
          chunkIndex: d.chunkIndex,
        },
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

// ============ pgvector 实现（默认 prod） ============

interface PgVectorConfig {
  url: string
  table: string
  dim: number
}

class PgVectorStore implements VectorStore {
  readonly kind = 'pgvector' as const
  private pg: any
  constructor(private cfg: PgVectorConfig) {}

  async init(): Promise<void> {
    if (!this.cfg.url) throw new Error('PGVECTOR_URL / DATABASE_URL is required')
    const mod = await import('pg').catch(() => null)
    if (!mod) {
      throw new Error('需要安装 pg 包：pnpm add pg；或切到 sqlite 后端')
    }
    const { Pool } = (mod as { Pool: new (cfg: { connectionString: string }) => any })
    this.pg = new Pool({ connectionString: this.cfg.url })
    await this.pg.query('CREATE EXTENSION IF NOT EXISTS vector')
    await this.pg.query(
      `CREATE TABLE IF NOT EXISTS ${this.tbl()} (
        id text PRIMARY KEY,
        knowledge_base_id text NOT NULL,
        chunk_index integer,
        content text,
        embedding vector(${this.cfg.dim})
      )`,
    )
    await this.pg.query(
      `CREATE INDEX IF NOT EXISTS ${this.cfg.table}_kb_idx ON ${this.tbl()} (knowledge_base_id)`,
    )
    await this.pg
      .query(
        `CREATE INDEX IF NOT EXISTS ${this.cfg.table}_emb_idx
         ON ${this.tbl()} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,
      )
      .catch(() => undefined)
  }

  private tbl(): string {
    return `"${this.cfg.table.replace(/"/g, '')}"`
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return
    for (const r of records) {
      await this.pg.query(
        `INSERT INTO ${this.tbl()} (id, knowledge_base_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           knowledge_base_id = EXCLUDED.knowledge_base_id,
           chunk_index = EXCLUDED.chunk_index,
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding`,
        [
          r.id,
          String(r.payload.knowledgeBaseId),
          r.payload.chunkIndex ?? null,
          (r.payload.content as string) ?? null,
          toPgVector(r.vector),
        ],
      )
    }
  }

  async deleteByKnowledgeBase(knowledgeBaseId: string | number): Promise<void> {
    await this.pg.query(`DELETE FROM ${this.tbl()} WHERE knowledge_base_id = $1`, [
      String(knowledgeBaseId),
    ])
  }

  async query(
    vector: number[],
    topK: number,
    filter: VectorQueryFilter = {},
  ): Promise<VectorQueryHit[]> {
    const params: unknown[] = [toPgVector(vector)]
    let sql = `SELECT id, knowledge_base_id, chunk_index, content,
                 1 - (embedding <=> $1) AS score
               FROM ${this.tbl()}`
    if (filter.knowledgeBaseId !== undefined) {
      params.push(String(filter.knowledgeBaseId))
      sql += ` WHERE knowledge_base_id = $${params.length}`
    }
    params.push(topK)
    sql += ` ORDER BY embedding <=> $1 LIMIT $${params.length}`
    const r = await this.pg.query(sql, params)
    return r.rows.map((row: any) => ({
      id: row.id,
      score: Number(row.score),
      payload: {
        knowledgeBaseId: row.knowledge_base_id,
        chunkIndex: row.chunk_index,
        content: row.content,
      },
    }))
  }
}

// ============ utils ============

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`
}

function extractId(ref: unknown): string | number | undefined {
  if (ref === null || ref === undefined) return undefined
  if (typeof ref === 'string' || typeof ref === 'number') return ref
  if (typeof ref === 'object') {
    return (ref as { id?: string | number }).id
  }
  return undefined
}

/** 测试用：清空缓存 */
export function _resetVectorStoreCache() {
  cached = undefined
}
