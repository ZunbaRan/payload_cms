import type { CollectionAfterChangeHook } from 'payload'

/**
 * 文章审核联动：当 ArticleReview 创建/更新后，同步到文章本体。
 *  - decision=approved → article.reviewStatus=approved，并将 status 推到 published（若仍是 pending-review）
 *  - decision=rejected → article.reviewStatus=rejected，status 退回 draft
 *  - decision=needs-revision → 仅写 reviewStatus，不动 status
 */
export const articleReviewSyncHook: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (context?.skipReviewSync) return doc
  const articleRef = (doc as Record<string, unknown>).article
  const articleId =
    typeof articleRef === 'object' && articleRef !== null
      ? (articleRef as { id?: string | number }).id
      : (articleRef as string | number | undefined)
  if (articleId === undefined || articleId === null) return doc

  const decision = (doc as { decision?: string }).decision
  const update: Record<string, unknown> = {}

  if (decision === 'approved') {
    update.reviewStatus = 'approved'
    const article = await req.payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
    })
    if ((article as { status?: string }).status === 'pending-review') {
      update.status = 'published'
      if (!(article as { publishedAt?: string }).publishedAt) {
        update.publishedAt = new Date().toISOString()
      }
    }
  } else if (decision === 'rejected') {
    update.reviewStatus = 'rejected'
    update.status = 'draft'
  } else if (decision === 'needs-revision') {
    update.reviewStatus = 'unreviewed'
  }

  if (Object.keys(update).length === 0) return doc

  await req.payload.update({
    collection: 'articles',
    id: articleId,
    data: update,
    depth: 0,
    overrideAccess: true,
    context: { skipReviewSync: true },
  })

  return doc
}
