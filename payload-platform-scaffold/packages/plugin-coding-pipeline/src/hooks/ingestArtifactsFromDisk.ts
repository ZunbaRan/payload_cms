/**
 * @fileoverview 文件系统 → DB：phase 结束后把磁盘变更读回数据库
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Payload } from 'payload'

export interface IngestInput {
  payload: Payload
  changeId: string
  projectDir: string
  /** 是否解析 tasks.md 为结构化 pipeline-tasks 行（推荐 plan 阶段后开启） */
  parseTasks?: boolean
}

export async function ingestArtifactsFromDisk(input: IngestInput): Promise<void> {
  const { payload, changeId, projectDir, parseTasks } = input
  const change = await payload.findByID({ collection: 'pipeline-openspec-changes', id: changeId })
  const changeDir = path.join(projectDir, 'openspec', 'changes', change.name)
  const specsDir = path.join(changeDir, 'specs')

  const proposal = readIfExists(path.join(changeDir, 'proposal.md'))
  const design   = readIfExists(path.join(changeDir, 'design.md'))
  const tasksMd  = readIfExists(path.join(changeDir, 'tasks.md'))

  await payload.update({
    collection: 'pipeline-openspec-changes',
    id: changeId,
    data: { proposalMd: proposal, designMd: design, tasksMd },
  })

  // BDD specs
  if (fs.existsSync(specsDir)) {
    for (const f of fs.readdirSync(specsDir)) {
      if (!f.endsWith('.md')) continue
      const content = fs.readFileSync(path.join(specsDir, f), 'utf8')
      const scenarioCount = (content.match(/##\s*Scenario:/gi) ?? []).length

      const existing = await payload.find({
        collection: 'pipeline-bdd-specs',
        where: { and: [{ change: { equals: changeId } }, { fileName: { equals: f } }] },
        limit: 1,
      })
      if (existing.docs[0]) {
        await payload.update({
          collection: 'pipeline-bdd-specs',
          id: existing.docs[0].id,
          data: { content, scenarioCount },
        })
      } else {
        await payload.create({
          collection: 'pipeline-bdd-specs',
          data: { change: changeId, fileName: f, content, scenarioCount },
        })
      }
    }
  }

  if (parseTasks && tasksMd) await syncTasks(payload, changeId, tasksMd)
}

function readIfExists(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/** 解析 `## Wave N` + `- [x] T-XX: desc` 为结构化 tasks 行 */
async function syncTasks(payload: Payload, changeId: string, tasksMd: string): Promise<void> {
  let wave = 1
  for (const line of tasksMd.split('\n')) {
    const waveMatch = line.match(/^##\s*Wave\s+(\d+)/i)
    if (waveMatch) { wave = Number(waveMatch[1]); continue }

    const taskMatch = line.match(/^- \[([ x])\]\s+(T-\d+):\s*(.+)$/i)
    if (!taskMatch) continue
    const [, mark, code, descRaw] = taskMatch
    const status = mark.toLowerCase() === 'x' ? 'done' : 'open'
    const description = descRaw.trim()

    const existing = await payload.find({
      collection: 'pipeline-tasks',
      where: { and: [{ change: { equals: changeId } }, { code: { equals: code } }] },
      limit: 1,
    })
    if (existing.docs[0]) {
      await payload.update({
        collection: 'pipeline-tasks',
        id: existing.docs[0].id,
        data: { wave, description, status },
      })
    } else {
      await payload.create({
        collection: 'pipeline-tasks',
        data: { change: changeId, code, wave, description, status },
      })
    }
  }
}
