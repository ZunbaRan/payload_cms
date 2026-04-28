import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

/**
 * 维护父级 library 的计数字段。
 * 用法：在 child collection 的 hooks 中绑定。
 */
export function makeCountSyncHooks(opts: {
  parentCollection: 'title-libraries' | 'keyword-libraries' | 'image-libraries'
  parentField: 'titleCount' | 'keywordCount' | 'imageCount'
  childForeignKey: 'library'
}): {
  afterChange: CollectionAfterChangeHook
  afterDelete: CollectionAfterDeleteHook
} {
  const recompute = async (req: any, parentRef: unknown, childCollection: string) => {
    const parentId = extractId(parentRef)
    if (parentId === undefined || parentId === null) return
    const total = await req.payload.count({
      collection: childCollection,
      where: { [opts.childForeignKey]: { equals: parentId } },
    })
    await req.payload.update({
      collection: opts.parentCollection,
      id: parentId as string | number,
      data: { [opts.parentField]: total.totalDocs },
      depth: 0,
      overrideAccess: true,
    })
  }

  return {
    afterChange: async ({ doc, previousDoc, req, collection }) => {
      const newParent = (doc as Record<string, unknown>)[opts.childForeignKey]
      const oldParent = previousDoc
        ? (previousDoc as Record<string, unknown>)[opts.childForeignKey]
        : undefined
      await recompute(req, newParent, collection.slug)
      const newId = extractId(newParent)
      const oldId = extractId(oldParent)
      if (oldId !== undefined && oldId !== newId) {
        await recompute(req, oldParent, collection.slug)
      }
    },
    afterDelete: async ({ doc, req, collection }) => {
      const parent = (doc as Record<string, unknown>)[opts.childForeignKey]
      await recompute(req, parent, collection.slug)
    },
  }
}

function extractId(ref: unknown): string | number | undefined {
  if (ref === null || ref === undefined) return undefined
  if (typeof ref === 'string' || typeof ref === 'number') return ref
  if (typeof ref === 'object') {
    const id = (ref as { id?: string | number; value?: string | number }).id ??
      (ref as { value?: string | number }).value
    return id
  }
  return undefined
}
