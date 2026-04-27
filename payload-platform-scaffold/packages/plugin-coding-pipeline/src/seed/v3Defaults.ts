/**
 * @fileoverview V3 默认配置 seed
 *
 * 启动时若 collections 为空，写入：
 *   - 1 个默认 model
 *   - 5 个 agent roles（planner/coder/tester/reflector/memory）
 *   - 5 条 prompt templates（来自 promptBodies.ts，原文复制自 workflow/coding_pipline/prompts.ts）
 */

import type { Payload } from 'payload'
import {
  PLANNER_PROMPT, CODER_PROMPT, TESTER_PROMPT, REFLECTOR_PROMPT, MEMORY_PROMPT,
} from './promptBodies'

const DEFAULT_MODEL_NAME = 'claude-sonnet-4-6'

const ROLE_DEFS: Array<{
  slug: string
  role: 'planner' | 'coder' | 'tester' | 'reflector' | 'memory'
  promptLabel: string
  body: string
  allowedTools?: string[]
  maxTurns?: number
}> = [
  { slug: 'v3-planner',   role: 'planner',
    promptLabel: 'V3 Planner (OpenSpec)',
    body: PLANNER_PROMPT,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    maxTurns: 60 },
  { slug: 'v3-coder',     role: 'coder',
    promptLabel: 'V3 Coder (Superpowers TDD)',
    body: CODER_PROMPT,
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'TodoWrite'],
    maxTurns: 200 },
  { slug: 'v3-tester',    role: 'tester',
    promptLabel: 'V3 Tester (Ralph + BDD)',
    body: TESTER_PROMPT,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    maxTurns: 60 },
  { slug: 'v3-reflector', role: 'reflector',
    promptLabel: 'V3 Reflector (PM)',
    body: REFLECTOR_PROMPT,
    allowedTools: ['Read', 'Bash'],
    maxTurns: 30 },
  { slug: 'v3-memory',    role: 'memory',
    promptLabel: 'V3 Memory Agent',
    body: MEMORY_PROMPT,
    allowedTools: ['Read', 'Write', 'Edit'],
    maxTurns: 10 },
]

export async function seedV3Defaults(payload: Payload): Promise<void> {
  const existing = await payload.find({
    collection: 'pipeline-agent-roles', limit: 1,
  })
  if (existing.totalDocs > 0) {
    payload.logger.info('[coding-pipeline] seed skipped (already initialised)')
    return
  }

  payload.logger.info('[coding-pipeline] seeding V3 defaults...')

  const model = await payload.create({
    collection: 'pipeline-models',
    data: { name: DEFAULT_MODEL_NAME, provider: 'anthropic', enabled: true },
  })

  for (const def of ROLE_DEFS) {
    const role = await payload.create({
      collection: 'pipeline-agent-roles',
      data: {
        slug: def.slug,
        role: def.role,
        displayName: def.slug,
        defaultModel: model.id,
        permissionMode: 'acceptEdits',
        maxTurns: def.maxTurns ?? 60,
        allowedTools: (def.allowedTools ?? []).map((tool) => ({ tool })),
      },
    })

    const prompt = await payload.create({
      collection: 'pipeline-prompt-templates',
      data: { label: def.promptLabel, role: role.id, version: 1, active: true, body: def.body },
    })

    await payload.update({
      collection: 'pipeline-agent-roles', id: role.id,
      data: { activePrompt: prompt.id },
    })
  }

  payload.logger.info('[coding-pipeline] seed complete')
}
