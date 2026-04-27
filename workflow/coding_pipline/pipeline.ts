/**
 * @fileoverview Pipeline V3 主类
 *
 * 架构：prepare → plan(OpenSpec+Brainstorming) → code(Superpowers,无Ralph) →
 *        test(Ralph+BDD) → reflect(PM独立) → [outer loop if REVISE]
 *
 * 关键 V3 变化：
 * - Planner 使用 OpenSpec 生成标准化 artifacts（proposal/specs/design/tasks）
 * - Coder 使用 Superpowers TDD skills，无 Ralph Loop（单次直接执行）
 * - Tester 读取 BDD specs/*.md 而非自由文本 testTasks
 * - Reflector 纯 PM 视角，ACCEPTED → 触发 openspec archive
 * - MEMORY.md §0 由 pipeline 维护，不经过 Memory Agent
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

import { ClaudeAgent } from '../core/agent/claude-agent.js'
import type { AgentLogEvent } from '../core/agent/claude-agent.js'

import {
  ensureGitRepo,
  resolveMainBranch,
  createFeatureBranch,
  commitAll,
} from '../core/worktree.js'

import {
  runWithRalph,
  type RalphAgentOptions,
} from './ralph.js'

import {
  runMemoryAgent,
  readMemory,
  writeMemory,
  initMemory,
  updateSection0Progress,
  getGitDiff,
  getHeadSha,
} from './memory.js'

import {
  PLANNER_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
  REFLECTOR_SYSTEM_PROMPT,
} from './prompts.js'

import type {
  PipelineV3Options,
  Plan,
  OpenSpecArtifacts,
  PipelineV3Result,
  V3ProgressEvent,
  V3Phase,
} from './types.js'

// ---------------------------------------------------------------------------
// Skill installation
// ---------------------------------------------------------------------------

// NOTE: ensurePlaywrightSkill preserved here for fallback — superseded by
// ensureAgentBrowser (agent-browser CLI) which is now the default browser tool.
//
// function ensurePlaywrightSkill(projectDir: string, log: (msg: string) => void): void {
//   const skillsDir = path.join(projectDir, '.claude', 'skills')
//   fs.mkdirSync(skillsDir, { recursive: true })
//   const pwSkillDir = path.join(skillsDir, 'playwright-cli')
//   if (fs.existsSync(pwSkillDir)) return
//
//   try { execSync('playwright-cli --version', { stdio: 'pipe' }) } catch {
//     log('[Tools] Installing @playwright/cli globally...')
//     execSync('npm install -g @playwright/cli@latest', { stdio: 'pipe', timeout: 120_000 })
//   }
//   try {
//     execSync('playwright-cli install --skills', { cwd: projectDir, stdio: 'pipe' })
//     log('[Tools] playwright-cli skill installed')
//   } catch (e) {
//     log(`[Tools] playwright-cli install --skills failed: ${e}`)
//   }
// }

/** 安装 agent-browser CLI 并写入 skill stub 到 projectDir/.claude/skills/ */
function ensureAgentBrowser(projectDir: string, log: (msg: string) => void): void {
  // 1. Ensure CLI is installed
  try {
    execSync('agent-browser --version', { stdio: 'pipe' })
  } catch {
    log('[Tools] Installing agent-browser globally...')
    execSync('npm install -g agent-browser', { stdio: 'pipe', timeout: 120_000 })
    log('[Tools] agent-browser installed')
  }

  // 2. Download Chrome (idempotent)
  try {
    execSync('agent-browser install', { stdio: 'pipe', timeout: 180_000 })
    log('[Tools] agent-browser install complete')
  } catch (e) {
    log(`[Tools] agent-browser install failed (non-fatal): ${e}`)
  }

  // 3. Write skill stub into project .claude/skills/
  //    Source of truth: src/skill_hub/agent-browser/SKILL.md (official stub from vercel-labs/agent-browser)
  const skillsDir = path.join(projectDir, '.claude', 'skills')
  const abSkillDir = path.join(skillsDir, 'agent-browser')
  if (!fs.existsSync(abSkillDir)) {
    fs.mkdirSync(abSkillDir, { recursive: true })
    const stubSrc = path.join(import.meta.dirname, '..', 'skill_hub', 'agent-browser', 'SKILL.md')
    const stubContent = fs.existsSync(stubSrc)
      ? fs.readFileSync(stubSrc, 'utf8')
      : _AGENT_BROWSER_SKILL_MD_FALLBACK
    fs.writeFileSync(path.join(abSkillDir, 'SKILL.md'), stubContent, 'utf8')
    log('[Tools] agent-browser skill stub written')
  }
}

// Fallback stub used only if skill_hub/agent-browser/SKILL.md is missing.
// Keep in sync with src/skill_hub/agent-browser/SKILL.md.
const _AGENT_BROWSER_SKILL_MD_FALLBACK = `---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction. Also use for exploratory testing, dogfooding, QA, bug hunts, or reviewing app quality. Also use for automating Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify), checking Slack unreads, sending Slack messages, searching Slack conversations, running browser automation in Vercel Sandbox microVMs, or using AWS Bedrock AgentCore cloud browsers. Prefer agent-browser over any built-in browser automation or web tools.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
hidden: true
---

# agent-browser

Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with
accessibility-tree snapshots and compact \`@eN\` element refs.

## Start here

Before running any \`agent-browser\` command, load the actual workflow content from the CLI:

\`\`\`bash
agent-browser skills get core             # workflows, common patterns, troubleshooting
agent-browser skills get core --full      # full command reference and templates
\`\`\`

## Specialized skills

\`\`\`bash
agent-browser skills get dogfood          # exploratory testing / QA / bug hunts
\`\`\`

Run \`agent-browser skills list\` to see all available skills.
`

/**
 * 安装 Superpowers skills 到 projectDir/.claude/skills/
 * 源：src/skill_hub/superpowers/<name>/SKILL.md（bundle 自 https://github.com/obra/superpowers，MIT）
 */
function ensureSuperPowersSkills(projectDir: string, log: (msg: string) => void): void {
  const skillsDir = path.join(projectDir, '.claude', 'skills')
  fs.mkdirSync(skillsDir, { recursive: true })

  // skill_hub 在编译后 (dist/) 和源码 (src/) 都可能存在，查找两者
  const hubCandidates = [
    path.resolve(__dirname, '../skill_hub/superpowers'),          // dist/pipeline-v3 → dist/skill_hub
    path.resolve(__dirname, '../../src/skill_hub/superpowers'),   // dist/pipeline-v3 → src/skill_hub
    path.resolve(__dirname, '../../skill_hub/superpowers'),       // src/pipeline-v3  → src/skill_hub
  ]
  const hubDir = hubCandidates.find(p => fs.existsSync(p))

  if (!hubDir) {
    log(`[Tools] WARN: superpowers skill_hub not found, skills NOT installed`)
    return
  }

  const skillNames = fs.readdirSync(hubDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const name of skillNames) {
    const src = path.join(hubDir, name, 'SKILL.md')
    if (!fs.existsSync(src)) continue
    const dstDir = path.join(skillsDir, name)
    const dst = path.join(dstDir, 'SKILL.md')
    // 总是覆盖以确保用最新版（避免陈旧 stub 卡住）
    fs.mkdirSync(dstDir, { recursive: true })
    fs.writeFileSync(dst, fs.readFileSync(src, 'utf8'), 'utf8')
    log(`[Tools] Superpowers skill installed: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// OpenSpec utilities
// ---------------------------------------------------------------------------

/**
 * 确保 openspec CLI 已安装，运行 openspec init（幂等）
 */
function ensureOpenSpec(projectDir: string, log: (msg: string) => void): void {
  // Check if openspec CLI is available
  try {
    execSync('openspec --version', { stdio: 'pipe' })
  } catch {
    log('[OpenSpec] openspec CLI not found, installing @fission-ai/openspec...')
    try {
      execSync('npm install -g @fission-ai/openspec', { stdio: 'pipe', timeout: 120_000 })
      log('[OpenSpec] @fission-ai/openspec installed')
    } catch (e) {
      log(`[OpenSpec] Failed to install openspec: ${e}. Continuing without CLI.`)
    }
  }

  // openspec init (idempotent — safe to run if already initialized)
  const openspecDir = path.join(projectDir, 'openspec')
  if (!fs.existsSync(openspecDir)) {
    try {
      execSync('openspec init', { cwd: projectDir, stdio: 'pipe' })
      log('[OpenSpec] openspec init complete')
    } catch (e) {
      log(`[OpenSpec] openspec init failed: ${e}. Creating directory manually.`)
      fs.mkdirSync(path.join(projectDir, 'openspec', 'changes'), { recursive: true })
      fs.mkdirSync(path.join(projectDir, 'openspec', 'specs'), { recursive: true })
    }
  } else {
    log('[OpenSpec] openspec already initialized')
  }
}

/**
 * 创建 openspec change 目录结构
 * Pipeline 负责创建目录，Planner 负责填写内容
 */
function createOpenSpecChange(projectDir: string, changeName: string, log: (msg: string) => void): OpenSpecArtifacts {
  const changeDir = path.join(projectDir, 'openspec', 'changes', changeName)
  const specsDir = path.join(changeDir, 'specs')

  // Try CLI first, fall back to manual creation
  try {
    if (!fs.existsSync(changeDir)) {
      execSync(`openspec new change ${changeName}`, { cwd: projectDir, stdio: 'pipe' })
      log(`[OpenSpec] Created change via CLI: ${changeName}`)
    }
  } catch {
    log(`[OpenSpec] CLI new change failed, creating manually: ${changeName}`)
  }

  // Ensure all required directories/files exist
  fs.mkdirSync(specsDir, { recursive: true })

  const artifacts: OpenSpecArtifacts = {
    changeName,
    changeDir,
    specsDir,
    tasksFile: path.join(changeDir, 'tasks.md'),
    proposalFile: path.join(changeDir, 'proposal.md'),
    designFile: path.join(changeDir, 'design.md'),
  }

  // Create placeholder files if they don't exist (Planner will fill them)
  const placeholders: Array<[string, string]> = [
    [artifacts.proposalFile, '# Proposal\n\n_To be written by Planner._\n'],
    [artifacts.designFile, '# Design\n\n_To be written by Planner._\n'],
    [artifacts.tasksFile, '# Tasks\n\n_To be written by Planner._\n'],
  ]
  for (const [filepath, content] of placeholders) {
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, content, 'utf8')
    }
  }

  log(`[OpenSpec] Change directory ready: ${changeDir}`)
  return artifacts
}

/**
 * 验证 Planner 写入的 OpenSpec artifacts 是否有效
 * 返回错误信息列表（空数组表示通过）
 */
function validateOpenSpecArtifacts(artifacts: OpenSpecArtifacts): string[] {
  const errors: string[] = []

  // Check proposal.md
  if (!fs.existsSync(artifacts.proposalFile)) {
    errors.push('Missing proposal.md')
  } else {
    const content = fs.readFileSync(artifacts.proposalFile, 'utf8')
    if (content.includes('_To be written by Planner._') || content.trim().length < 100) {
      errors.push('proposal.md appears empty or unwritten')
    }
  }

  // Check tasks.md — must have checkbox items
  if (!fs.existsSync(artifacts.tasksFile)) {
    errors.push('Missing tasks.md')
  } else {
    const content = fs.readFileSync(artifacts.tasksFile, 'utf8')
    if (!content.includes('- [ ]')) {
      errors.push('tasks.md has no checkbox items (- [ ] T-XX format required)')
    }
  }

  // Check specs/ — must have at least one .md with BDD scenarios
  const specFiles = fs.existsSync(artifacts.specsDir)
    ? fs.readdirSync(artifacts.specsDir).filter(f => f.endsWith('.md'))
    : []
  if (specFiles.length === 0) {
    errors.push('specs/ directory has no .md files')
  } else {
    const hasScenarios = specFiles.some(f => {
      const content = fs.readFileSync(path.join(artifacts.specsDir, f), 'utf8')
      return content.toUpperCase().includes('WHEN') && content.toUpperCase().includes('THEN')
    })
    if (!hasScenarios) {
      errors.push('specs/*.md files have no BDD scenarios (WHEN/THEN format required)')
    }
  }

  // Check design.md
  if (!fs.existsSync(artifacts.designFile)) {
    errors.push('Missing design.md')
  }

  return errors
}

/**
 * 读取 specs/*.md 文件内容，合并为单个字符串供 Tester 使用
 */
function readBDDSpecs(artifacts: OpenSpecArtifacts): string {
  if (!fs.existsSync(artifacts.specsDir)) return ''
  const specFiles = fs.readdirSync(artifacts.specsDir).filter(f => f.endsWith('.md'))
  if (specFiles.length === 0) return ''
  return specFiles
    .map(f => {
      const content = fs.readFileSync(path.join(artifacts.specsDir, f), 'utf8')
      return `### ${f}\n\n${content}`
    })
    .join('\n\n---\n\n')
}

/**
 * 检查 tasks.md 中是否所有任务都已标记 [x]
 */
function allTasksComplete(tasksFile: string): boolean {
  if (!fs.existsSync(tasksFile)) return false
  const content = fs.readFileSync(tasksFile, 'utf8')
  const unchecked = content.match(/^- \[ \]/gm)
  return !unchecked || unchecked.length === 0
}

/**
 * 运行 openspec archive
 */
function runOpenSpecArchive(projectDir: string, changeName: string, log: (msg: string) => void): void {
  try {
    execSync(`openspec archive ${changeName}`, { cwd: projectDir, stdio: 'pipe' })
    log(`[OpenSpec] Archived change: ${changeName}`)
  } catch (e) {
    log(`[OpenSpec] Archive failed (non-fatal): ${e}`)
  }
}

// ---------------------------------------------------------------------------
// Reflector output parsing
// ---------------------------------------------------------------------------

function parseReflectorDecision(output: string): { accepted: boolean; newRequirement?: string } {
  const upper = output.toUpperCase()
  if (upper.includes('ACCEPTED')) return { accepted: true }

  const reviseMatch = output.match(/REVISE:\s*([\s\S]+)/i)
  if (reviseMatch) {
    return { accepted: false, newRequirement: reviseMatch[1].trim() }
  }

  return { accepted: false, newRequirement: output.trim() }
}

// ---------------------------------------------------------------------------
// Sanitize change name
// ---------------------------------------------------------------------------

function sanitizeChangeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '') || 'change'
}

// ---------------------------------------------------------------------------
// PipelineV3
// ---------------------------------------------------------------------------

export class PipelineV3 {
  private readonly opts: Required<
    Pick<PipelineV3Options, 'projectDir' | 'requirement' | 'maxOuterLoops' | 'ralphMaxIterations'>
  > & PipelineV3Options

  private featureBranch = ''
  private totalCostUsd = 0
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private log: (msg: string) => void
  private completedStages: string[] = []

  constructor(opts: PipelineV3Options) {
    this.opts = {
      maxOuterLoops: 3,
      ralphMaxIterations: 20,
      ...opts,
    } as typeof this.opts
    this.log = (msg: string) => {
      this.opts.onProgress?.({ phase: 'plan', status: 'progress', message: msg })
      console.log(msg)
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async run(): Promise<PipelineV3Result> {
    const { projectDir, requirement } = this.opts
    const logs: string[] = []
    const origLog = this.log.bind(this)
    this.log = (msg: string) => { logs.push(msg); origLog(msg) }

    let success = false
    let outerLoops = 0
    let lastReflectorOutput = ''
    const originalRequirement = requirement
    let currentRequirement = requirement

    this.emit({ phase: 'prepare', status: 'start', message: 'Preparing workspace' })
    const changeName = await this.phasePrepare()
    this.emit({ phase: 'prepare', status: 'complete', message: `Workspace ready — change: ${changeName}` })

    while (outerLoops < this.opts.maxOuterLoops) {
      outerLoops++
      this.log(`[Pipeline V3] Outer loop ${outerLoops}/${this.opts.maxOuterLoops}`)

      // Suffix change name for subsequent loops
      const loopChangeName = outerLoops === 1 ? changeName : `${changeName}-v${outerLoops}`
      this.completedStages = []

      // ── Plan ──────────────────────────────────────────────────────────────
      this.emit({ phase: 'plan', status: 'start', message: 'Planning with OpenSpec', iteration: outerLoops })
      updateSection0Progress(projectDir, {
        outerLoop: outerLoops,
        totalOuterLoops: this.opts.maxOuterLoops,
        currentStage: 'plan',
        completedStages: this.completedStages,
        changeName: loopChangeName,
      })

      const plan = await this.phasePlan(currentRequirement, loopChangeName, outerLoops)
      this.completedStages.push('plan')
      updateSection0Progress(projectDir, {
        outerLoop: outerLoops,
        totalOuterLoops: this.opts.maxOuterLoops,
        currentStage: 'code',
        completedStages: this.completedStages,
      })
      this.emit({ phase: 'plan', status: 'complete', message: 'OpenSpec artifacts ready', iteration: outerLoops })

      // ── Code ──────────────────────────────────────────────────────────────
      this.emit({ phase: 'code', status: 'start', message: 'Coding with Superpowers TDD', iteration: outerLoops })
      const codeSha = getHeadSha(projectDir)
      const codeOutput = await this.phaseCode(plan, currentRequirement)
      await this.updateMemory('coder', codeOutput, codeSha, currentRequirement, outerLoops)
      this.completedStages.push('code')
      updateSection0Progress(projectDir, {
        outerLoop: outerLoops,
        totalOuterLoops: this.opts.maxOuterLoops,
        currentStage: 'test',
        completedStages: this.completedStages,
      })
      this.emit({ phase: 'code', status: 'complete', message: 'Coding complete', iteration: outerLoops })

      // ── Test ──────────────────────────────────────────────────────────────
      this.emit({ phase: 'test', status: 'start', message: 'Testing BDD acceptance', iteration: outerLoops })
      const testSha = getHeadSha(projectDir)
      const testResult = await this.phaseTest(plan, currentRequirement)
      await this.updateMemory('tester', testResult.output, testSha, currentRequirement, outerLoops)
      this.completedStages.push('test')
      updateSection0Progress(projectDir, {
        outerLoop: outerLoops,
        totalOuterLoops: this.opts.maxOuterLoops,
        currentStage: 'reflect',
        completedStages: this.completedStages,
      })
      this.emit({ phase: 'test', status: 'complete', message: testResult.completed ? 'All BDD scenarios passed' : 'Testing ended (max iterations)', iteration: outerLoops })

      // ── Commit ────────────────────────────────────────────────────────────
      commitAll(projectDir, `feat: code+test loop ${outerLoops}`)

      // ── Reflect ───────────────────────────────────────────────────────────
      this.emit({ phase: 'reflect', status: 'start', message: 'PM acceptance review', iteration: outerLoops })
      const reflectSha = getHeadSha(projectDir)
      const reflectOutput = await this.phaseReflect(originalRequirement, currentRequirement)
      lastReflectorOutput = reflectOutput
      await this.updateMemory('reflector', reflectOutput, reflectSha, currentRequirement, outerLoops)
      this.completedStages.push('reflect')
      this.emit({ phase: 'reflect', status: 'complete', message: reflectOutput.slice(0, 80), iteration: outerLoops })

      const decision = parseReflectorDecision(reflectOutput)

      if (decision.accepted) {
        success = true
        this.log(`[Pipeline V3] ✓ ACCEPTED after ${outerLoops} outer loop(s)`)

        // Run openspec archive
        runOpenSpecArchive(projectDir, loopChangeName, this.log.bind(this))
        commitAll(projectDir, `chore: archive openspec change ${loopChangeName}`)
        break
      }

      if (outerLoops < this.opts.maxOuterLoops && decision.newRequirement) {
        this.log(`[Pipeline V3] REVISE → new requirement: ${decision.newRequirement.slice(0, 100)}`)
        // Carry forward original requirement + reflector feedback
        currentRequirement = `${originalRequirement}\n\nAdditional feedback from previous iteration:\n${decision.newRequirement}`
      } else {
        this.log(`[Pipeline V3] Max outer loops reached — ending`)
        commitAll(projectDir, `feat: pipeline-v3 max loops (loop ${outerLoops})`)
        break
      }
    }

    this.emit({ phase: 'complete', status: 'complete', message: success ? 'Pipeline complete' : 'Pipeline ended (max loops)' })

    // Final commit — ensure all remaining changes are captured on the feature branch
    commitAll(projectDir, success
      ? `chore: pipeline-v3 complete — ${this.featureBranch}`
      : `chore: pipeline-v3 ended (max loops ${outerLoops}) — ${this.featureBranch}`,
    )

    return {
      success,
      outerLoops,
      reflectorOutput: lastReflectorOutput,
      log: logs,
      tokenUsage: { input: this.totalInputTokens, output: this.totalOutputTokens },
      totalCostUsd: this.totalCostUsd,
      featureBranch: this.featureBranch,
      projectDir,
    }
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------

  private async phasePrepare(): Promise<string> {
    const { projectDir, requirement, claudeMd } = this.opts

    ensureGitRepo(projectDir)
    const mainBranch = resolveMainBranch(projectDir)

    const changeName = sanitizeChangeName(requirement)
    this.featureBranch = createFeatureBranch(projectDir, changeName, mainBranch)
    this.log(`[Prepare] Feature branch: ${this.featureBranch}`)

    // Write CLAUDE.md if provided
    if (claudeMd) {
      fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), claudeMd, 'utf8')
      this.log('[Prepare] CLAUDE.md written')
    }

    // Initialize MEMORY.md with §0 pre-populated
    initMemory(projectDir, requirement, 1, this.opts.maxOuterLoops, changeName)
    this.log('[Prepare] MEMORY.md initialized (5-section V3 structure)')

    // Install tools
    ensureOpenSpec(projectDir, this.log.bind(this))
    ensureAgentBrowser(projectDir, this.log.bind(this))
    ensureSuperPowersSkills(projectDir, this.log.bind(this))

    return changeName
  }

  private async phasePlan(requirement: string, changeName: string, outerLoop: number): Promise<Plan> {
    const { projectDir, model } = this.opts

    // Pipeline creates the change directory (not Planner)
    const artifacts = createOpenSpecChange(projectDir, changeName, this.log.bind(this))

    const claudeMd = this.readProjectFile('CLAUDE.md')
    const memory = readMemory(projectDir)

    const prompt = [
      `## Your Task`,
      `Fill in the OpenSpec change artifacts for the following requirement.`,
      `The change directory has already been created at:`,
      `  ${artifacts.changeDir}`,
      ``,
      `Write these files:`,
      `  - ${artifacts.proposalFile}`,
      `  - ${artifacts.specsDir}/<feature>.md  (one per feature area)`,
      `  - ${artifacts.designFile}`,
      `  - ${artifacts.tasksFile}`,
      ``,
      `## Requirement`,
      requirement,
      ``,
      claudeMd ? `## Project Context (CLAUDE.md)\n${claudeMd}` : '',
      outerLoop > 1 ? `## Iteration Context\nThis is outer loop ${outerLoop}. Review MEMORY.md §4 (Reflector Judgment) for what needs to improve.` : '',
      memory ? `## Development Memory (MEMORY.md)\n${memory}` : '',
    ].filter(Boolean).join('\n')

    const planSha = getHeadSha(projectDir)
    let planCostUsd = 0

    const agent = new ClaudeAgent(
      { name: 'planner', model: model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6' },
      {
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        cwd: projectDir,
        maxTurns: 30,
        settingSources: ['project'],
        onEvent: (event: AgentLogEvent) => {
          if (event.type === 'result') planCostUsd += ((event.data as Record<string, unknown>).cost_usd as number) ?? 0
          this.makeEventHandler('planner')(event)
        },
      },
    )

    const result = await agent.run(prompt)
    this.totalCostUsd += planCostUsd
    this.totalInputTokens += result.tokenUsage.input_tokens
    this.totalOutputTokens += result.tokenUsage.output_tokens

    // Validate artifacts
    const errors = validateOpenSpecArtifacts(artifacts)
    if (errors.length > 0) {
      this.log(`[Plan] Artifact validation warnings: ${errors.join('; ')}`)
      // Non-fatal: log and continue (don't block pipeline on first-run issues)
    }

    // Memory update for planner
    await this.updateMemory('planner', result.output, planSha, requirement, outerLoop)

    return { artifacts, raw: result.output }
  }

  private async phaseCode(plan: Plan, requirement: string): Promise<string> {
    const { projectDir, model } = this.opts
    const claudeMd = this.readProjectFile('CLAUDE.md')
    const memory = readMemory(projectDir)

    const tasksContent = fs.existsSync(plan.artifacts.tasksFile)
      ? fs.readFileSync(plan.artifacts.tasksFile, 'utf8')
      : '(tasks.md not found)'

    const prompt = [
      `## Your Task`,
      `Implement all tasks listed in tasks.md using Superpowers TDD.`,
      ``,
      `tasks.md location: ${plan.artifacts.tasksFile}`,
      ``,
      `## tasks.md Content`,
      tasksContent,
      ``,
      `## Original Requirement`,
      requirement,
      ``,
      claudeMd ? `## Project Context (CLAUDE.md)\n${claudeMd}` : '',
      memory ? `## Development Memory (MEMORY.md)\n${memory}` : '',
      ``,
      `Read the skills in .claude/skills/ before starting.`,
      `Follow TDD: RED → GREEN → REFACTOR → REVIEW → COMMIT → MARK [x] for each task.`,
      `When ALL tasks are [x] and tests pass, output: <promise>CODING_COMPLETE</promise>`,
    ].filter(Boolean).join('\n')

    let codeCostUsd = 0

    // AbortController: abort the coder agent as soon as CODING_COMPLETE is detected
    // in any assistant_text event. This prevents the agent from hanging indefinitely
    // waiting for background sub-agents (e.g. E2E tests) to return.
    const abortController = new AbortController()
    let codingCompleteSeen = false

    // Phase timeout: 4 hours max (prevents infinite hang)
    const PHASE_TIMEOUT_MS = 4 * 60 * 60 * 1000
    const timeoutHandle = setTimeout(() => {
      if (!abortController.signal.aborted) {
        this.log('[Code] ⏱ Phase timeout (4h) reached — aborting coder agent')
        abortController.abort()
      }
    }, PHASE_TIMEOUT_MS)

    // Coder runs as direct agent (no Ralph Loop) — Superpowers TDD handles internal iteration
    const agent = new ClaudeAgent(
      { name: 'coder', model: model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6' },
      {
        systemPrompt: CODER_SYSTEM_PROMPT,
        cwd: projectDir,
        maxTurns: 100,
        settingSources: ['project'],
        abortController,
        cleanupListeningPorts: true,
        onEvent: (event: AgentLogEvent) => {
          if (event.type === 'result') {
            codeCostUsd += ((event.data as Record<string, unknown>).cost_usd as number) ?? 0
          }
          // Detect CODING_COMPLETE in any assistant text — abort immediately
          if (event.type === 'assistant_text' && !codingCompleteSeen) {
            const text = String(event.data.text ?? '')
            if (text.includes('CODING_COMPLETE')) {
              codingCompleteSeen = true
              this.log('[Code] CODING_COMPLETE detected — aborting background sub-agents')
              abortController.abort()
            }
          }
          this.makeEventHandler('coder')(event)
        },
        hooks: {
          PreToolUse: [{
            matcher: 'Edit|Write|MultiEdit',
            hooks: [async (input: Record<string, unknown>) => {
              const filePath = String(
                (input.tool_input as Record<string, unknown>)?.file_path
                ?? (input.tool_input as Record<string, unknown>)?.path
                ?? ''
              )
              if (filePath.endsWith('MEMORY.md')) {
                this.log('[Hook] Coder attempted to write MEMORY.md — blocked')
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'MEMORY.md is managed exclusively by the Memory Agent.',
                  },
                }
              }
              return {}
            }],
          }],
        },
      },
    )

    let result
    try {
      result = await agent.run(prompt)
    } finally {
      clearTimeout(timeoutHandle)
    }

    this.totalCostUsd += codeCostUsd
    this.totalInputTokens += result.tokenUsage.input_tokens
    this.totalOutputTokens += result.tokenUsage.output_tokens

    // Secondary completion check: verify tasks.md all [x]
    const tasksComplete = allTasksComplete(plan.artifacts.tasksFile)
    if (!tasksComplete) {
      this.log('[Code] Warning: CODING_COMPLETE signal detected but tasks.md still has unchecked items')
    }

    return result.output
  }

  private async phaseTest(plan: Plan, requirement: string): Promise<{ output: string; completed: boolean }> {
    const { projectDir, model, ralphMaxIterations } = this.opts
    const claudeMd = this.readProjectFile('CLAUDE.md')
    const memory = readMemory(projectDir)

    const bddSpecs = readBDDSpecs(plan.artifacts)

    const prompt = [
      `## Your Task`,
      `Verify that the implementation satisfies all BDD acceptance scenarios below.`,
      ``,
      `## BDD Acceptance Scenarios`,
      bddSpecs || '(No BDD specs found — run all tests and verify the implementation manually)',
      ``,
      `## Original Requirement`,
      requirement,
      ``,
      claudeMd ? `## Project Context (CLAUDE.md)\n${claudeMd}` : '',
      memory ? `## Development Memory (MEMORY.md)\n${memory}` : '',
      ``,
      `## STEP 1 — Visual Baseline (REQUIRED FIRST — do this before running any automated tests)`,
      `Run these commands in order. Do NOT skip any step.`,
      `\`\`\``,
      `mkdir -p screenshots`,
      `agent-browser skills get core`,
      `agent-browser open http://localhost:{PORT}`,
      `agent-browser snapshot -i`,
      `agent-browser screenshot --annotate screenshots/baseline-homepage.png`,
      `Read(screenshots/baseline-homepage.png)`,
      `agent-browser close`,
      `\`\`\``,
      `After completing Step 1, output exactly: VISUAL BASELINE CAPTURED: screenshots/baseline-homepage.png`,
      `You MUST see this line in your output before proceeding to Step 2.`,
      ``,
      `## STEP 2 — BDD Scenario Verification`,
      `For each BDD scenario above, use agent-browser to verify it visually. For each scenario:`,
      `1. \`agent-browser skills get core\` then \`agent-browser open http://localhost:{PORT}\``,
      `2. Interact to reach the scenario state`,
      `3. \`agent-browser screenshot --annotate screenshots/{scenario-slug}-result.png\``,
      `4. \`Read(screenshots/{scenario-slug}-result.png)\`  ← loads image into your vision so you can SEE the result`,
      `5. \`agent-browser close\``,
      `Fix any bugs you find. If a scenario fails, fix the code and reverify.`,
      ``,
      `## STEP 3 — Automated Tests`,
      `Run the full automated test suite: \`npm test && npm run test:e2e\``,
      `Fix any failures. Re-run until all pass.`,
      ``,
      `When STEP 1 (VISUAL BASELINE CAPTURED) + STEP 2 (all scenarios visually verified) + STEP 3 (all tests pass) are done, output: <promise>TESTING_COMPLETE</promise>`,
    ].filter(Boolean).join('\n')

    const ralphOpts: RalphAgentOptions = {
      systemPrompt: TESTER_SYSTEM_PROMPT,
      projectDir,
      model,
      turnsPerIteration: 60,
      settingSources: ['project'],
      onLog: this.log.bind(this),
      onEvent: this.makeEventHandler('tester'),
    }

    const result = await runWithRalph(
      'tester',
      prompt,
      { completionPromise: 'TESTING_COMPLETE', maxIterations: ralphMaxIterations! },
      ralphOpts,
    )

    this.totalCostUsd += result.costUsd
    this.totalInputTokens += result.tokenUsage.input
    this.totalOutputTokens += result.tokenUsage.output

    return { output: result.output, completed: result.completed }
  }

  private async phaseReflect(originalRequirement: string, currentRequirement: string): Promise<string> {
    const { projectDir, model } = this.opts
    const claudeMd = this.readProjectFile('CLAUDE.md')
    const memory = readMemory(projectDir)
    const diff = getGitDiff(projectDir)

    const prompt = [
      `## Original Requirement (your ONLY acceptance criteria — do not go beyond this)`,
      originalRequirement,
      ``,
      currentRequirement !== originalRequirement
        ? `## Current Iteration Requirement\n${currentRequirement}\n`
        : '',
      claudeMd ? `## Project Context (CLAUDE.md)\n${claudeMd}` : '',
      memory ? `## Full Development Memory (MEMORY.md)\n${memory}` : '',
      ``,
      `## REQUIRED: Visual Inspection Before Judgment`,
      `Run in order — do NOT skip. Your judgment must be grounded in what you actually see.`,
      `\`\`\``,
      `agent-browser skills get core`,
      `agent-browser open http://localhost:{PORT}`,
      `agent-browser snapshot -i`,
      `agent-browser screenshot --annotate screenshots/reflector-check.png`,
      `Read(screenshots/reflector-check.png)`,
      `agent-browser close`,
      `\`\`\``,
      `Replace {PORT} with the port from MEMORY.md. After reading the screenshot, you will see the actual UI.`,
      `Navigate 1-2 more pages relevant to the requirement, screenshot + Read each before closing.`,
      ``,
      `## SCOPE RULE`,
      `You may only output REVISE if a feature explicitly listed in the original requirement`,
      `above is missing or completely broken. Do NOT add requirements not in the original text.`,
      ``,
      `Output ACCEPTED if all explicitly stated features work, even if the product could be improved.`,
      `Output REVISE: <which specific requirement item is unmet> only if required features are absent.`,
    ].filter(Boolean).join('\n')

    let reflectCostUsd = 0
    const agent = new ClaudeAgent(
      { name: 'reflector', model: model ?? process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-6' },
      {
        systemPrompt: REFLECTOR_SYSTEM_PROMPT,
        cwd: projectDir,
        maxTurns: 15,
        settingSources: ['project'],
        onEvent: (event: AgentLogEvent) => {
          if (event.type === 'result') reflectCostUsd += ((event.data as Record<string, unknown>).cost_usd as number) ?? 0
          this.makeEventHandler('reflector')(event)
        },
      },
    )

    const result = await agent.run(prompt)
    this.totalCostUsd += reflectCostUsd
    this.totalInputTokens += result.tokenUsage.input_tokens
    this.totalOutputTokens += result.tokenUsage.output_tokens
    return result.output
  }

  // -------------------------------------------------------------------------
  // Memory helper
  // -------------------------------------------------------------------------

  private async updateMemory(
    agentRole: 'planner' | 'coder' | 'tester' | 'reflector',
    agentOutput: string,
    sinceShaBefore: string,
    requirement: string,
    outerLoop: number,
  ): Promise<void> {
    const { projectDir, model } = this.opts
    const currentMemory = readMemory(projectDir)
    const gitDiff = getGitDiff(projectDir, sinceShaBefore || undefined)

    this.emit({ phase: 'memory', status: 'start', message: `Updating memory after ${agentRole}` })
    try {
      await runMemoryAgent(projectDir, {
        agentRole,
        agentOutput,
        currentMemory,
        gitDiff,
        requirement,
        outerLoop,
        totalOuterLoops: this.opts.maxOuterLoops,
      }, {
        model,
        onEvent: this.makeEventHandler('memory-agent'),
      })
      this.log(`[Memory] Updated MEMORY.md after ${agentRole}`)
    } catch (err) {
      this.log(`[Memory] Failed to update memory after ${agentRole}: ${err}`)
    }
    this.emit({ phase: 'memory', status: 'complete', message: `Memory updated` })
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private readProjectFile(filename: string): string {
    const p = path.join(this.opts.projectDir, filename)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  }

  private emit(event: V3ProgressEvent): void {
    this.opts.onProgress?.(event)
  }

  private makeEventHandler(agentName: string) {
    const phase: V3Phase = agentName === 'planner' ? 'plan'
      : agentName === 'coder' ? 'code'
      : agentName === 'tester' ? 'test'
      : agentName === 'reflector' ? 'reflect'
      : 'memory'
    return (event: AgentLogEvent) => {
      this.opts.onProgress?.({
        phase,
        status: 'progress',
        message: `[${agentName}] ${event.type}`,
        data: { agent: agentName, event },
      })
    }
  }
}

