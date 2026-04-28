import type { TaskConfig } from 'payload'
import { htmlToLexical } from '@scaffold/shared'

/**
 * importUrlBatch
 * 抓取 url-import-jobs 里的所有 url，每条产生一篇 article（草稿）+ 日志。
 * 极简实现：fetch HTML → 提取 <title> → 转 Lexical 正文。
 */
export const importUrlBatch: TaskConfig<'importUrlBatch'> = {
  slug: 'importUrlBatch',
  inputSchema: [{ name: 'jobId', type: 'text', required: true }],
  outputSchema: [
    { name: 'processed', type: 'number' },
    { name: 'failed', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const job = (await payload.findByID({
      collection: 'url-import-jobs',
      id: input.jobId,
      depth: 0,
    })) as { urls?: { url: string }[]; targetCategory?: string } | null
    if (!job) throw new Error(`UrlImportJob ${input.jobId} not found`)

    await payload.update({
      collection: 'url-import-jobs',
      id: input.jobId,
      data: {
        status: 'running',
        startedAt: new Date().toISOString(),
        totalUrls: job.urls?.length ?? 0,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    let processed = 0
    let failed = 0

    for (const item of job.urls || []) {
      try {
        const res = await fetch(item.url)
        const httpStatus = res.status
        const html = await res.text()
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || item.url).trim()
        const article = await payload.create({
          collection: 'articles',
          data: {
            title,
            slug: 'imported-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            excerpt: title,
            content: htmlToLexical(html),
            status: 'draft',
            category: job.targetCategory,
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        await payload.create({
          collection: 'url-import-job-logs',
          data: {
            job: input.jobId,
            url: item.url,
            status: 'success',
            httpStatus,
            extractedTitle: title,
            contentLength: html.length,
            createdArticle: article.id,
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        processed += 1
      } catch (err) {
        failed += 1
        await payload.create({
          collection: 'url-import-job-logs',
          data: {
            job: input.jobId,
            url: item.url,
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          } as never,
          depth: 0,
          overrideAccess: true,
        })
      }
    }

    await payload.update({
      collection: 'url-import-jobs',
      id: input.jobId,
      data: {
        status: failed === 0 ? 'completed' : 'failed',
        processedUrls: processed,
        failedUrls: failed,
        finishedAt: new Date().toISOString(),
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    return { output: { processed, failed } }
  },
}
