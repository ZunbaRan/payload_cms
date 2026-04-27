/**
 * @fileoverview 校验 Planner 产物完整性（plan 阶段完成后调用）
 *
 * 等价于 workflow/coding_pipline/pipeline.ts#validateOpenSpecArtifacts，
 * 但读 DB 而不是文件系统。
 */

import type { Payload } from 'payload'

export interface ValidateInput {
  payload: Payload
  changeId: string
}

export async function validateOpenSpec(input: ValidateInput): Promise<string[]> {
  const { payload, changeId } = input
  const errors: string[] = []
  const change = await payload.findByID({ collection: 'pipeline-openspec-changes', id: changeId })

  if (!change.proposalMd || change.proposalMd.trim().length < 100
      || change.proposalMd.includes('To be written by Planner')) {
    errors.push('proposal.md appears empty or unwritten')
  }
  if (!change.tasksMd?.includes('- [ ]')) {
    errors.push('tasks.md has no checkbox items (- [ ] T-XX format required)')
  }
  if (!change.designMd) {
    errors.push('design.md is missing')
  }

  const specs = await payload.find({
    collection: 'pipeline-bdd-specs',
    where: { change: { equals: changeId } },
    limit: 50,
  })
  if (specs.totalDocs === 0) {
    errors.push('no specs/*.md files written')
  } else {
    const hasScenarios = specs.docs.some((s: any) =>
      typeof s.content === 'string'
      && s.content.toUpperCase().includes('WHEN')
      && s.content.toUpperCase().includes('THEN'))
    if (!hasScenarios) errors.push('specs/*.md files have no BDD scenarios (WHEN/THEN required)')
  }

  return errors
}
