import type { TaskConfig } from 'payload'
import { createAiClient, renderTemplate, plainTextToLexical } from '@scaffold/shared'

/**
 * processTaskRun
 * 输入：taskId, taskRunId
 * 流程：
 *   1. 加载 task / prompt / aiModel
 *   2. 取一个 pending 标题（如配置了 titleLibrary）
 *   3. 装配 Prompt 变量并调用 AI 生成正文
 *   4. 创建 article（draft 或 published 视 autoPublish）
 *   5. 更新 task-run 状态 + token 用量
 */
export const processTaskRun: TaskConfig<'processTaskRun'> = {
  slug: 'processTaskRun',
  inputSchema: [
    { name: 'taskId', type: 'text', required: true },
    { name: 'taskRunId', type: 'text', required: true },
  ],
  outputSchema: [
    { name: 'articleId', type: 'text' },
    { name: 'totalTokens', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const startedAt = new Date()

    const task = await payload.findByID({
      collection: 'tasks',
      id: input.taskId,
      depth: 2,
    })
    if (!task) throw new Error(`Task ${input.taskId} not found`)

    const prompt = task.prompt as { systemPrompt?: string; userTemplate?: string } | null | undefined
    const model = task.aiModel as
      | { provider: string; modelId: string; baseUrl?: string; apiKey: string; temperature?: number; maxTokens?: number }
      | null
      | undefined

    if (!prompt?.userTemplate) throw new Error('Task is missing prompt or userTemplate')
    if (!model?.apiKey) throw new Error('Task is missing aiModel or apiKey')

    // 取一个待用标题（可选）
    let titleDoc: { id: string; text: string } | null = null
    const titleLibrary = task.titleLibrary as { id: string } | null | undefined
    if (titleLibrary?.id) {
      const found = await payload.find({
        collection: 'titles',
        where: {
          and: [
            { library: { equals: titleLibrary.id } },
            { status: { equals: 'pending' } },
          ],
        },
        limit: 1,
        depth: 0,
      })
      titleDoc = (found.docs[0] as never) ?? null
    }

    const titleText = titleDoc?.text || `自动生成内容 ${startedAt.toISOString()}`

    // 拼装关键词样本
    let keywordsSample: string[] = []
    const keywordLibrary = task.keywordLibrary as { id: string } | null | undefined
    if (keywordLibrary?.id) {
      const kws = await payload.find({
        collection: 'keywords',
        where: { library: { equals: keywordLibrary.id } },
        limit: 8,
        depth: 0,
      })
      keywordsSample = kws.docs.map((d: { text?: string }) => d.text || '').filter(Boolean)
    }

    const userPrompt = renderTemplate(prompt.userTemplate, {
      title: titleText,
      keywords: keywordsSample.join(', '),
      category: (task.category as { name?: string } | null)?.name || '',
    })

    const ai = createAiClient({
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
    })

    const completion = await ai.generate({
      systemPrompt: prompt.systemPrompt,
      userPrompt,
    })

    // 选作者
    const authors = (task.authors as { id: string }[] | null | undefined) || []
    const authorId = authors.length ? authors[Math.floor(Math.random() * authors.length)].id : undefined

    const article = await payload.create({
      collection: 'articles',
      data: {
        title: titleText,
        slug: slugify(titleText) + '-' + Date.now().toString(36),
        excerpt: completion.content.slice(0, 200),
        content: plainTextToLexical(completion.content),
        status: task.autoPublish ? 'published' : 'draft',
        publishedAt: task.autoPublish ? new Date().toISOString() : undefined,
        author: authorId,
        category: (task.category as { id: string } | null)?.id,
        isAiGenerated: true,
        sourceTask: input.taskId,
        sourceTitle: titleDoc?.id,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    if (titleDoc?.id) {
      await payload.update({
        collection: 'titles',
        id: titleDoc.id,
        data: { status: 'used' } as never,
        depth: 0,
        overrideAccess: true,
      })
    }

    const finishedAt = new Date()
    await payload.update({
      collection: 'task-runs',
      id: input.taskRunId,
      data: {
        status: 'success',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        articlesCreated: [article.id],
        tokenUsage: {
          prompt: completion.promptTokens,
          completion: completion.completionTokens,
          total: completion.totalTokens,
        },
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    await payload.update({
      collection: 'tasks',
      id: input.taskId,
      data: {
        lastRunAt: finishedAt.toISOString(),
        totalRuns: ((task.totalRuns as number) || 0) + 1,
        totalArticles: ((task.totalArticles as number) || 0) + 1,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    return {
      output: {
        articleId: String(article.id),
        totalTokens: completion.totalTokens ?? 0,
      },
    }
  },
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}
