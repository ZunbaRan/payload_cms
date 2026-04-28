/**
 * 自测/演示脚本：
 *   tsx scripts/test-flow.ts
 *
 * 流程：
 *   1. 启动 Payload（getPayload）
 *   2. 创建一个 admin user（如不存在）
 *   3. 创建敏感词 / 标题库 / 标题 / Prompt / AI 模型 / 任务
 *   4. 测试 sensitiveWordScan：直接 create 含敏感词文章应该被 block
 *   5. 测试 counter：title-libraries.titleCount 应该等于刚创建的 title 数
 *   6. 测试 KB 切片 hook：写入 rawContent → chunkCount 自动同步
 *   7. （可选）入队 processTaskRun，并尝试运行一次 jobs.run() 看是否处理
 */

import 'dotenv/config'
import { mkAi } from './_helpers'
import config from '../src/payload.config'
import { getPayload } from 'payload'

async function main() {
  console.log('▶︎ Booting Payload...')
  const payload = await getPayload({ config })

  // 1. admin user
  const adminEmail = 'admin@local.test'
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: adminEmail } },
    limit: 1,
  })
  let adminId: string | number
  if (existing.docs.length === 0) {
    const u = await payload.create({
      collection: 'users',
      data: { email: adminEmail, password: 'Admin123!' } as never,
    })
    adminId = u.id
    console.log('  ✓ created admin', adminEmail)
  } else {
    adminId = existing.docs[0].id
    console.log('  ✓ admin exists', adminEmail)
  }

  // 2. 敏感词
  const swList = await payload.find({
    collection: 'sensitive-words',
    where: { word: { equals: '禁词' } },
    limit: 1,
  })
  if (swList.docs.length === 0) {
    await payload.create({
      collection: 'sensitive-words',
      data: { word: '禁词', action: 'block', isActive: true } as never,
      overrideAccess: true,
    })
    console.log('  ✓ created sensitive word "禁词" (block)')
  }

  // 3. title library + 3 个 title
  const lib = await ensureTitleLibrary(payload, 'demo-library')
  for (let i = 1; i <= 3; i++) {
    await payload.create({
      collection: 'titles',
      data: { text: `自动测试标题 ${i}`, library: lib.id, status: 'pending' } as never,
      overrideAccess: true,
    })
  }
  const refreshedLib = await payload.findByID({ collection: 'title-libraries', id: lib.id })
  console.log('  ✓ titleCount synced =', (refreshedLib as { titleCount?: number }).titleCount)

  // 4. 测试敏感词 hook
  let blocked = false
  try {
    await payload.create({
      collection: 'articles',
      data: {
        title: '一篇含禁词的测试文章',
        slug: 'block-test-' + Date.now(),
        excerpt: 'this should hit 禁词',
        status: 'draft',
      } as never,
      overrideAccess: true,
    })
  } catch (e) {
    blocked = true
    console.log('  ✓ sensitive-word block hook fired:', (e as Error).message)
  }
  if (!blocked) console.log('  ✗ sensitive-word hook did not block!')

  // 5. KB 切片 hook
  const kb = await payload.create({
    collection: 'knowledge-bases',
    data: {
      name: 'KB Demo ' + Date.now(),
      sourceType: 'manual',
      rawContent: 'a'.repeat(2500),
      chunkSize: 800,
      chunkOverlap: 100,
    } as never,
    overrideAccess: true,
  })
  const refreshedKb = await payload.findByID({ collection: 'knowledge-bases', id: kb.id })
  console.log(
    '  ✓ KB chunkCount =',
    (refreshedKb as { chunkCount?: number }).chunkCount,
    '(expected ~ 4)',
  )

  // 6. AI model + Prompt + Task
  const ai = await ensureAiModel(payload)
  const prompt = await ensurePrompt(payload)
  const task = await ensureTask(payload, lib.id, prompt.id, ai.id)

  // 7. 入队 + 立即跑一次（不消费 token：未配 OPENAI_API_KEY 则跳过）
  if (process.env.OPENAI_API_KEY || process.env.AI_TEST_API_KEY) {
    const run = await payload.create({
      collection: 'task-runs',
      data: { task: task.id, status: 'queued', triggerType: 'manual' } as never,
      overrideAccess: true,
    })
    await payload.jobs.queue({
      task: 'processTaskRun',
      input: { taskId: String(task.id), taskRunId: String(run.id) },
    })
    console.log('  ▶︎ queued processTaskRun, running once...')
    const result = await payload.jobs.run({ limit: 5 })
    console.log('  ✓ jobs.run result:', JSON.stringify(result, null, 2))
  } else {
    // 没有真实 API key 时也演示一次入队（不会成功，但能验证 jobs.queue 链路）
    const run = await payload.create({
      collection: 'task-runs',
      data: { task: task.id, status: 'queued', triggerType: 'manual' } as never,
      overrideAccess: true,
    })
    const job = await payload.jobs.queue({
      task: 'processTaskRun',
      input: { taskId: String(task.id), taskRunId: String(run.id) },
    })
    console.log('  ✓ jobs.queue ok, jobId =', job.id, '(skipping run, no API key)')
  }

  console.log('\n✅ Self-test finished.')
  process.exit(0)
}

async function ensureTitleLibrary(payload: any, name: string) {
  const found = await payload.find({
    collection: 'title-libraries',
    where: { name: { equals: name } },
    limit: 1,
  })
  if (found.docs[0]) return found.docs[0]
  return payload.create({
    collection: 'title-libraries',
    data: { name } as never,
    overrideAccess: true,
  })
}

async function ensureAiModel(payload: any) {
  const found = await payload.find({
    collection: 'ai-models',
    where: { modelId: { equals: 'gpt-4o-mini' } },
    limit: 1,
  })
  if (found.docs[0]) return found.docs[0]
  return payload.create({
    collection: 'ai-models',
    data: mkAi() as never,
    overrideAccess: true,
  })
}

async function ensurePrompt(payload: any) {
  const found = await payload.find({
    collection: 'prompts',
    where: { name: { equals: 'demo-prompt' } },
    limit: 1,
  })
  if (found.docs[0]) return found.docs[0]
  return payload.create({
    collection: 'prompts',
    data: {
      name: 'demo-prompt',
      systemPrompt: '你是一个 SEO 写作助手，输出 200-300 字的简短文章。',
      userTemplate: '请基于关键词 {{keywords}} 写一篇标题为《{{title}}》的文章。',
      variables: [{ key: 'title' }, { key: 'keywords' }, { key: 'category' }],
    } as never,
    overrideAccess: true,
  })
}

async function ensureTask(payload: any, libId: any, promptId: any, aiId: any) {
  const found = await payload.find({
    collection: 'tasks',
    where: { name: { equals: 'demo-task' } },
    limit: 1,
  })
  if (found.docs[0]) return found.docs[0]
  return payload.create({
    collection: 'tasks',
    data: {
      name: 'demo-task',
      titleLibrary: libId,
      prompt: promptId,
      aiModel: aiId,
      autoPublish: false,
    } as never,
    overrideAccess: true,
  })
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
