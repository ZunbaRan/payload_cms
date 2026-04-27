/**
 * @fileoverview Job: archiveOpenSpec — 对应 `openspec archive <name>` CLI
 *
 * 触发：OuterLoops 进入 status=accepted 时。
 */

import type { TaskHandler } from 'payload'
import { execSync } from 'node:child_process'

export const archiveOpenSpecHandler: TaskHandler<'archiveOpenSpec'> = async ({ input, req }) => {
  const { changeId } = input as { changeId: string }
  const payload = req.payload

  const change = await payload.findByID({ collection: 'pipeline-openspec-changes', id: changeId, depth: 2 })
  const run: any = change.run
  const project: any = run.project
  const projectDir = project.gitRepoPath

  try {
    execSync(`openspec archive ${change.name}`, { cwd: projectDir, stdio: 'pipe' })
    payload.logger.info(`[coding-pipeline] archived openspec change ${change.name}`)
  } catch (e) {
    payload.logger.warn(`[coding-pipeline] openspec archive failed (non-fatal): ${e}`)
  }

  await payload.update({
    collection: 'pipeline-openspec-changes', id: changeId,
    data: { archived: true, archivedAt: new Date() },
  })
  return { output: { archived: true } }
}
