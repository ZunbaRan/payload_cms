/**
 * @fileoverview DB → 文件系统：把 openspec change 与 MEMORY.md 写到 git worktree
 *
 * 决策 1：DB 是 source of truth；每个 phase 启动前由此 hook 同步到磁盘。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Payload } from 'payload'

export interface RenderInput {
  payload: Payload
  changeId: string
  projectDir: string
}

export async function renderArtifactsToDisk(input: RenderInput): Promise<{ changeDir: string }> {
  const { payload, changeId, projectDir } = input
  const change = await payload.findByID({ collection: 'pipeline-openspec-changes', id: changeId })
  const changeDir = path.join(projectDir, 'openspec', 'changes', change.name)
  const specsDir = path.join(changeDir, 'specs')
  fs.mkdirSync(specsDir, { recursive: true })

  fs.writeFileSync(path.join(changeDir, 'proposal.md'), change.proposalMd ?? '', 'utf8')
  fs.writeFileSync(path.join(changeDir, 'design.md'),   change.designMd   ?? '', 'utf8')
  fs.writeFileSync(path.join(changeDir, 'tasks.md'),    change.tasksMd    ?? '', 'utf8')

  // BDD specs
  const specs = await payload.find({
    collection: 'pipeline-bdd-specs',
    where: { change: { equals: changeId } },
    limit: 100,
  })
  // Clean stale files (only ones that no longer exist in DB)
  if (fs.existsSync(specsDir)) {
    const dbNames = new Set(specs.docs.map((s: any) => s.fileName))
    for (const f of fs.readdirSync(specsDir)) {
      if (f.endsWith('.md') && !dbNames.has(f)) fs.unlinkSync(path.join(specsDir, f))
    }
  }
  for (const spec of specs.docs as any[]) {
    fs.writeFileSync(path.join(specsDir, spec.fileName), spec.content ?? '', 'utf8')
  }

  return { changeDir }
}

export async function renderMemoryToDisk(payload: Payload, runId: string, projectDir: string): Promise<void> {
  const snap = await payload.find({
    collection: 'pipeline-memory-snapshots',
    where: { run: { equals: runId } },
    sort: '-createdAt',
    limit: 1,
  })
  const content = (snap.docs[0] as any)?.content
  if (content) fs.writeFileSync(path.join(projectDir, 'MEMORY.md'), content, 'utf8')
}
