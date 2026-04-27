/**
 * @fileoverview @scaffold/plugin-coding-pipeline — Payload plugin entry
 *
 * 用法：
 *   plugins: [
 *     codingPipelinePlugin({
 *       seedDefaults: true,
 *       coreImportPath: '/abs/path/to/workflow/core/agent/claude-agent.ts',
 *     }),
 *   ]
 */

import type { Config, Plugin } from 'payload'
import { allCollections } from './collections'
import { tasks } from './jobs'
import { seedV3Defaults } from './seed'
import { applyReflectorVerdict } from './hooks'
import { setCoreImportPath } from './runtime/claudeBridge'
import { spawnOuterLoop, sanitizeChangeName } from './runtime/spawnOuterLoop'
import type { CodingPipelinePluginOptions } from './types'

export const codingPipelinePlugin =
  (options: CodingPipelinePluginOptions = {}): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming

    if (options.coreImportPath) setCoreImportPath(options.coreImportPath)

    // ── Run.afterChange: queued → schedule runPipeline ─────────────────────
    let cols = augmentCollection(allCollections, 'pipeline-runs', (col) => ({
      ...col,
      hooks: {
        ...(col.hooks ?? {}),
        afterChange: [
          ...(col.hooks?.afterChange ?? []),
          async ({ doc, previousDoc, req }: any) => {
            if (doc.status === 'queued' && previousDoc?.status !== 'queued') {
              try {
                await req.payload.jobs.queue({
                  task: 'runPipeline',
                  input: { runId: doc.id },
                })
              } catch (err) {
                req.payload.logger.warn(`[coding-pipeline] queue runPipeline failed: ${err}`)
              }
            }
          },
        ],
      },
    }))

    // ── OuterLoops.afterChange: verdict / manualVerdict 处理 ──────────────
    cols = augmentCollection(cols, 'pipeline-outer-loops', (col) => ({
      ...col,
      hooks: {
        ...(col.hooks ?? {}),
        afterChange: [
          ...(col.hooks?.afterChange ?? []),
          async ({ doc, previousDoc, req }: any) => {
            const payload = req.payload
            const verdictChanged = doc.verdict && doc.verdict !== previousDoc?.verdict
            const manualChanged = doc.manualVerdict && doc.manualVerdict !== previousDoc?.manualVerdict
            if (!verdictChanged && !manualChanged) return

            // 决定 final verdict
            // 优先用 manualVerdict；否则若 run.autoAdvance 才用 verdict
            const run = await payload.findByID({
              collection: 'pipeline-runs', id: doc.run, depth: 0,
            })
            let final: 'accepted' | 'revise' | undefined
            if (doc.manualVerdict) {
              final = doc.manualVerdict
            } else if (doc.verdict && run.autoAdvance !== false) {
              final = doc.verdict
            }
            if (!final) {
              // 自动模式关闭，且没人 override → 等审
              if (doc.status !== 'awaiting-review') {
                await payload.update({
                  collection: 'pipeline-outer-loops', id: doc.id,
                  data: { status: 'awaiting-review' },
                })
              }
              return
            }

            if (final === 'accepted') {
              const changeQ = await payload.find({
                collection: 'pipeline-openspec-changes',
                where: { outerLoop: { equals: doc.id } }, limit: 1,
              })
              if (changeQ.docs[0]) {
                await payload.jobs.queue({
                  task: 'archiveOpenSpec',
                  input: { changeId: changeQ.docs[0].id },
                })
              }
              if (doc.status !== 'accepted') {
                await payload.update({
                  collection: 'pipeline-outer-loops', id: doc.id,
                  data: { status: 'accepted' },
                })
              }
              await payload.update({
                collection: 'pipeline-runs', id: doc.run,
                data: { status: 'accepted', finishedAt: new Date() },
              })
              return
            }

            if (final === 'revise') {
              if (doc.status !== 'rejected' && doc.status !== 'revising') {
                await payload.update({
                  collection: 'pipeline-outer-loops', id: doc.id,
                  data: { status: 'revising' },
                })
              }

              const maxLoops = run.maxOuterLoops ?? 3
              const nextIndex = (doc.loopIndex ?? 0) + 1
              if (nextIndex >= maxLoops) {
                payload.logger.warn(
                  `[coding-pipeline] revise but max loops reached (${maxLoops}) — run rejected`,
                )
                await payload.update({
                  collection: 'pipeline-outer-loops', id: doc.id,
                  data: { status: 'rejected' },
                })
                await payload.update({
                  collection: 'pipeline-runs', id: doc.run,
                  data: { status: 'rejected', finishedAt: new Date() },
                })
                return
              }

              // 解析新需求
              let newRequirement = doc.manualNote ?? ''
              if (!newRequirement) {
                const m = String(doc.reflectorOutput ?? '').match(/REVISE:\s*([\s\S]+)/)
                newRequirement = m ? m[1].trim() : (doc.requirementText ?? '')
              }

              // 取 base name from previous change
              const prevChangeQ = await payload.find({
                collection: 'pipeline-openspec-changes',
                where: { outerLoop: { equals: doc.id } }, limit: 1,
              })
              const baseName =
                (prevChangeQ.docs[0]?.name as string)?.replace(/-r\d+$/, '') ??
                sanitizeChangeName(newRequirement.slice(0, 40))

              await spawnOuterLoop({
                payload, runId: doc.run, loopIndex: nextIndex,
                requirementText: newRequirement,
                changeNameBase: baseName,
              })
              payload.logger.info(
                `[coding-pipeline] spawned outerLoop #${nextIndex} for run=${doc.run}`,
              )
            }
          },
        ],
      },
    }))

    return {
      ...incoming,
      collections: [...(incoming.collections ?? []), ...cols],
      jobs: {
        ...(incoming.jobs ?? {}),
        tasks: [...((incoming.jobs as any)?.tasks ?? []), ...tasks],
      },
      onInit: async (payload) => {
        await incoming.onInit?.(payload)
        if (options.seedDefaults) {
          try {
            await seedV3Defaults(payload)
          } catch (err) {
            payload.logger.error(`[coding-pipeline] seed failed: ${err}`)
          }
        }
      },
    }
  }

// ── helpers ──────────────────────────────────────────────────────────────

function augmentCollection(
  collections: typeof allCollections,
  slug: string,
  fn: (col: (typeof allCollections)[number]) => (typeof allCollections)[number],
): typeof allCollections {
  return collections.map((c) => (c.slug === slug ? fn(c) : c))
}

export type { CodingPipelinePluginOptions } from './types'
export { allCollections } from './collections'
export { tasks } from './jobs'
export { seedV3Defaults } from './seed'
export { applyReflectorVerdict }
export { setCoreImportPath } from './runtime/claudeBridge'
