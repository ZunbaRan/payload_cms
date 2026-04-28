/**
 * vector-backends 自测：用确定性 hash embedding 验证 sqlite + pgvector 两个后端的
 * upsert / query / delete 都正常工作。
 *
 * 用法：
 *   pnpm test:vector                                # 仅 sqlite
 *   RUN_PGVECTOR=1 PGVECTOR_URL=postgres://... \
 *     PGVECTOR_DIM=8 pnpm test:vector               # sqlite + pgvector
 */

import 'dotenv/config'
import { createVectorStore, _resetVectorStoreCache } from '@scaffold/shared'
import config from '../src/payload.config'
import { getPayload } from 'payload'

const DIM = 8

function fakeEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0) as number[]
  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0
    v[cp % DIM] += 1
  }
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

async function runOnBackend(label: string, store: any, kbId: string) {
  console.log(`\n▶︎ [${label}] init`)
  await store.init()
  await store.deleteByKnowledgeBase(kbId)

  const docs = [
    { id: `${label}-1`, text: 'Payload CMS 支持 PostgreSQL 和 SQLite 数据库' },
    { id: `${label}-2`, text: 'GEOFlow 是一个 SEO 自动化写作平台' },
    { id: `${label}-3`, text: '苹果是一种水果，富含维生素' },
  ]
  const records = docs.map((d, i) => ({
    id: d.id,
    vector: fakeEmbed(d.text),
    payload: { knowledgeBaseId: kbId, chunkIndex: i, content: d.text },
  }))
  await store.upsert(records)
  console.log(`  ✓ upsert ${records.length} ok`)

  const q = fakeEmbed('Payload 数据库支持')
  const hits = await store.query(q, 3, { knowledgeBaseId: kbId })
  console.log(`  ✓ query returned ${hits.length} hits`)
  for (const h of hits) {
    const text = (h.payload?.content as string | undefined)?.slice(0, 40) || ''
    console.log(`    [${h.score.toFixed(3)}] ${h.id} :: ${text}`)
  }
  if (hits.length === 0) throw new Error(`${label}: no hits`)

  await store.deleteByKnowledgeBase(kbId)
  console.log(`  ✓ deleteByKnowledgeBase ok`)
}

async function main() {
  console.log('▶︎ Booting Payload...')
  const payload = await getPayload({ config })

  // === 1. sqlite 后端：通过 KB + 真实 chunks 验证 ===
  _resetVectorStoreCache()
  const sqliteStore = await createVectorStore('sqlite', { payload })
  const kb = await payload.create({
    collection: 'knowledge-bases',
    data: {
      name: 'vector-test-' + Date.now(),
      sourceType: 'manual',
      rawContent: 'placeholder',
      chunkSize: 100000,
      chunkOverlap: 0,
    } as never,
    overrideAccess: true,
  })
  // 清掉自动 chunk
  const old = await payload.find({
    collection: 'knowledge-chunks',
    where: { knowledgeBase: { equals: kb.id } },
    limit: 1000,
  })
  for (const c of old.docs) {
    await payload.delete({ collection: 'knowledge-chunks', id: c.id, overrideAccess: true })
  }
  const chunkIds: string[] = []
  const texts = ['Payload 数据库', 'GEOFlow 平台', '苹果水果']
  for (let i = 0; i < 3; i++) {
    const c = await payload.create({
      collection: 'knowledge-chunks',
      data: { knowledgeBase: kb.id, content: texts[i], chunkIndex: i } as never,
      overrideAccess: true,
    })
    chunkIds.push(String(c.id))
  }
  console.log('\n▶︎ [sqlite] init')
  await sqliteStore.init()
  await sqliteStore.upsert(
    chunkIds.map((id, i) => ({
      id,
      vector: fakeEmbed(texts[i]),
      payload: { knowledgeBaseId: kb.id, chunkIndex: i, content: '' },
    })),
  )
  const sHits = await sqliteStore.query(fakeEmbed('Payload 数据库'), 3, {
    knowledgeBaseId: kb.id,
  })
  console.log('  ✓ sqlite hits =', sHits.length, 'top =', sHits[0]?.id)
  if (sHits.length === 0) throw new Error('sqlite: no hits')

  // === 2. pgvector（可选）===
  if (process.env.RUN_PGVECTOR === '1') {
    _resetVectorStoreCache()
    process.env.PGVECTOR_DIM = String(DIM)
    const pgStore = await createVectorStore('pgvector')
    await runOnBackend('pgvector', pgStore, 'kb-pgv-test')
  }

  console.log('\n✅ vector-backends self-test passed.')
  process.exit(0)
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
