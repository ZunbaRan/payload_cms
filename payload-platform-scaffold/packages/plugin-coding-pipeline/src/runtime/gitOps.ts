/**
 * @fileoverview Lightweight git helpers — 自包含，避免依赖 workflow/core/worktree。
 *
 * 仅覆盖 prepare phase 需要的：
 *   - ensureGitRepo
 *   - resolveMainBranch
 *   - createFeatureBranch
 */

import { execSync } from 'node:child_process'
import * as path from 'node:path'

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function ensureGitRepo(cwd: string): void {
  try {
    run('git rev-parse --is-inside-work-tree', cwd)
  } catch {
    throw new Error(`Not a git repo: ${cwd}`)
  }
}

export function resolveMainBranch(cwd: string): string {
  // 优先 origin/HEAD
  try {
    const ref = run('git symbolic-ref refs/remotes/origin/HEAD', cwd)
    const m = ref.match(/refs\/remotes\/origin\/(.+)$/)
    if (m) return m[1]
  } catch { /* ignore */ }
  // 退化：检查 main / master
  for (const candidate of ['main', 'master']) {
    try {
      run(`git rev-parse --verify ${candidate}`, cwd)
      return candidate
    } catch { /* try next */ }
  }
  // 兜底：当前 HEAD
  return run('git rev-parse --abbrev-ref HEAD', cwd)
}

export function getCurrentBranch(cwd: string): string {
  return run('git rev-parse --abbrev-ref HEAD', cwd)
}

export function getHeadSha(cwd: string): string {
  return run('git rev-parse HEAD', cwd)
}

export function branchExists(cwd: string, branch: string): boolean {
  try {
    run(`git rev-parse --verify ${branch}`, cwd)
    return true
  } catch { return false }
}

export function sanitizeBranchName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9-_/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createFeatureBranch(cwd: string, changeName: string, mainBranch: string): string {
  const sanitized = sanitizeBranchName(changeName)
  let branch = `coding/${sanitized}`
  if (branchExists(cwd, branch)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    branch = `${branch}-${ts}`
  }
  // 切到 main，再创建分支
  run(`git checkout ${mainBranch}`, cwd)
  run(`git checkout -b ${branch}`, cwd)
  return branch
}

export function diffSinceSha(cwd: string, sha: string): string {
  try {
    return run(`git diff ${sha} HEAD`, cwd)
  } catch {
    return ''
  }
}

export function projectRoot(cwd: string): string {
  return path.resolve(run('git rev-parse --show-toplevel', cwd))
}
