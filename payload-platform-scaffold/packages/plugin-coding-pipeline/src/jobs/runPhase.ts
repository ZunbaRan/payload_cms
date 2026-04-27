/**
 * @fileoverview Job: runPhase — 执行单个 phase
 *
 * 流程（决策 1: DB → 文件 → Agent → 文件 → DB）：
 *
 *   1. 读 phase / outerLoop / run / project / agentRole / promptTemplate
 *   2. renderArtifactsToDisk + renderMemoryToDisk
 *   3. progressMemory（写 §0 当前阶段）
 *   4. 调 runAgent（test 阶段走 runRalphLoop，决策 2）
 *   5. ingestArtifactsFromDisk（plan 阶段开启 parseTasks）
 *   6. phase 专属验证：plan→validateOpenSpec / reflect→applyReflectorVerdict
 *   7. 标记 phase=done，调度下一个 phase
 *
 * 当前是骨架；S4-S6 逐步接入。
 */

import type { TaskHandler } from 'payload'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  renderArtifactsToDisk, renderMemoryToDisk, ingestArtifactsFromDisk,
  validateOpenSpec, applyReflectorVerdict, progressMemory,
} from '../hooks'
import { runAgent } from '../runtime/claudeBridge'
import { runRalphLoop } from '../runtime/ralph'
import { buildUserPrompt, TESTER_COMPLETION_PROMISE } from '../runtime/promptBuilder'
import { ensureGitRepo, resolveMainBranch, createFeatureBranch, getHeadSha, diffSinceSha } from '../runtime/gitOps'
import { PHASE_NAMES, type PhaseName } from '../types'

export const runPhaseHandler: TaskHandler<'runPhase'> = async ({ input, req }) => {
  const { phaseId } = input as { phaseId: string }
  const payload = req.payload

  const phase = await payload.findByID({ collection: 'pipeline-phases', id: phaseId, depth: 3 })
  const phaseName = phase.phaseName as PhaseName
  const outerLoop: any = phase.outerLoop
  const run = await payload.findByID({ collection: 'pipeline-runs', id: outerLoop.run, depth: 2 })
  const project: any = run.project
  const projectDir = project.gitRepoPath

  payload.logger.info(`[coding-pipeline] runPhase ${phaseName} runId=${run.id}`)

  await payload.update({
    collection: 'pipeline-phases', id: phaseId,
    data: { status: 'running', startedAt: new Date() },
  })

  try {
    // ── prepare：仅做 git/CLAUDE.md/MEMORY 初始化，无 LLM ─────────────────
    if (phaseName === 'prepare') {
      ensureGitRepo(projectDir)
      const headBefore = getHeadSha(projectDir)

      // 第 0 个 outer loop 才创建 feature branch；后续 loop 复用同一 branch
      const changeName = await getChangeName(payload, outerLoop.id)
      let featureBranch = run.featureBranch as string | undefined
      if (outerLoop.loopIndex === 0 || !featureBranch) {
        const mainBranch = resolveMainBranch(projectDir)
        featureBranch = createFeatureBranch(projectDir, changeName, mainBranch)
        await payload.update({
          collection: 'pipeline-runs', id: run.id,
          data: { featureBranch },
        })
      }

      // 写 CLAUDE.md（若 project 有定义）
      if (project.claudeMd && typeof project.claudeMd === 'string' && project.claudeMd.trim()) {
        const claudePath = path.join(projectDir, 'CLAUDE.md')
        fs.writeFileSync(claudePath, project.claudeMd, 'utf-8')
      }

      await progressMemory({
        payload, runId: run.id as string, phaseId,
        outerLoop: outerLoop.loopIndex,
        totalOuterLoops: run.maxOuterLoops ?? 3,
        currentStage: 'prepare',
        completedStages: [],
        changeName,
        requirement: outerLoop.requirementText,
        projectDir,
      })

      await payload.update({
        collection: 'pipeline-phases', id: phaseId,
        data: { headShaBefore: headBefore, headShaAfter: headBefore },
      })
      await markDone(payload, phaseId)
      await scheduleNextPhase(payload, outerLoop.id, phaseName)
      return { output: { skippedLLM: true, featureBranch } }
    }

    // 记录 LLM phase 开始前的 HEAD
    let headBefore: string | undefined
    try { headBefore = getHeadSha(projectDir) } catch { /* not a git repo? */ }

    // ── 找到当前 outerLoop 的 OpenSpec change ─────────────────────────────
    const changeFound = await payload.find({
      collection: 'pipeline-openspec-changes',
      where: { outerLoop: { equals: outerLoop.id } },
      limit: 1,
    })
    const change = changeFound.docs[0] as any
    if (!change) throw new Error(`No OpenSpec change for outerLoop ${outerLoop.id}`)

    // ── 1. DB → 磁盘 ──────────────────────────────────────────────────────
    const { changeDir } = await renderArtifactsToDisk({ payload, changeId: change.id, projectDir })
    await renderMemoryToDisk(payload, run.id as string, projectDir)

    // ── 2. 取 agentRole + active prompt ─────────────────────────────────
    const role: any = phase.agentRole
    if (!role) throw new Error(`Phase ${phaseName} has no agentRole`)
    const promptTpl = await payload.findByID({
      collection: 'pipeline-prompt-templates', id: role.activePrompt as string,
    })
    const model: any = role.defaultModel

    // ── 3. 拼 user prompt ────────────────────────────────────────────────
    const userPrompt = await buildUserPrompt({
      payload, phaseId, phaseName,
      requirement: outerLoop.requirementText, changeDir, projectDir,
    })

    // ── 4. 调 Agent ──────────────────────────────────────────────────────
    const agentInput = {
      payload, phaseId,
      systemPrompt: (promptTpl as any).body as string,
      prompt: userPrompt,
      agentName: role.slug,
      model: model.name,
      cwd: projectDir,
      maxTurns: role.maxTurns,
      maxBudgetUsd: role.maxBudgetUsd,
      permissionMode: role.permissionMode,
      env: project.env ?? {},
    }

    const result = phaseName === 'test'
      ? await runRalphLoop({
          ...agentInput,
          completionPromise: TESTER_COMPLETION_PROMISE,
          maxIterations: run.ralphMaxIterations ?? 20,
        })
      : await runAgent(agentInput)

    // ── 5. 磁盘 → DB ─────────────────────────────────────────────────────
    await ingestArtifactsFromDisk({
      payload, changeId: change.id, projectDir,
      parseTasks: phaseName === 'plan',
    })

    // ── 6. phase 专属验证 ────────────────────────────────────────────────
    if (phaseName === 'plan') {
      const errors = await validateOpenSpec({ payload, changeId: change.id })
      if (errors.length > 0) {
        await markFailed(payload, phaseId, `OpenSpec validation failed:\n${errors.join('\n')}`)
        return { output: { errors } }
      }
    }

    if (phaseName === 'reflect') {
      const { verdict, newRequirement } = await applyReflectorVerdict({
        payload,
        outerLoopId: outerLoop.id,
        reflectorOutput: result.output,
      })
      payload.logger.info(`[coding-pipeline] reflector verdict=${verdict}`)
      // 进入 awaiting-review；OuterLoops.afterChange 处理后续
      void newRequirement
    }

    // ── 7. 收尾 ─────────────────────────────────────────────────────────
    let headAfter: string | undefined
    let gitDiff: string | undefined
    try {
      headAfter = getHeadSha(projectDir)
      if (headBefore && headAfter !== headBefore) {
        gitDiff = diffSinceSha(projectDir, headBefore).slice(0, 100_000)
      }
    } catch { /* ignore */ }

    await payload.update({
      collection: 'pipeline-phases', id: phaseId,
      data: {
        status: 'done',
        finishedAt: new Date(),
        rawOutput: result.output,
        costUsd: result.costUsd,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        ...(headBefore ? { headShaBefore: headBefore } : {}),
        ...(headAfter ? { headShaAfter: headAfter } : {}),
        ...(gitDiff ? { gitDiff } : {}),
      },
    })

    await scheduleNextPhase(payload, outerLoop.id, phaseName)
    return { output: { ok: true } }
  } catch (err) {
    await markFailed(payload, phaseId, String(err))
    throw err
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function markDone(payload: any, phaseId: string): Promise<void> {
  await payload.update({
    collection: 'pipeline-phases', id: phaseId,
    data: { status: 'done', finishedAt: new Date() },
  })
}

async function markFailed(payload: any, phaseId: string, error: string): Promise<void> {
  await payload.update({
    collection: 'pipeline-phases', id: phaseId,
    data: { status: 'failed', finishedAt: new Date(), error },
  })
}

async function scheduleNextPhase(payload: any, outerLoopId: string, currentPhase: PhaseName): Promise<void> {
  const idx = PHASE_NAMES.indexOf(currentPhase)
  if (idx < 0 || idx >= PHASE_NAMES.length - 1) return // reflect 之后由 OuterLoops hook 接管
  const nextName = PHASE_NAMES[idx + 1]
  const next = await payload.find({
    collection: 'pipeline-phases',
    where: { and: [{ outerLoop: { equals: outerLoopId } }, { phaseName: { equals: nextName } }] },
    limit: 1,
  })
  const nextPhase = next.docs[0]
  if (!nextPhase) return
  await payload.jobs.queue({ task: 'runPhase', input: { phaseId: nextPhase.id } })
}

async function getChangeName(payload: any, outerLoopId: string): Promise<string> {
  const r = await payload.find({
    collection: 'pipeline-openspec-changes',
    where: { outerLoop: { equals: outerLoopId } },
    limit: 1,
  })
  return r.docs[0]?.name ?? 'unknown'
}
