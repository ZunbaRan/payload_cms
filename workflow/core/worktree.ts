/**
 * @fileoverview Git 工具函数
 *
 * 提供 Pipeline 所需的 git 操作：仓库初始化、分支管理、提交等。
 */

import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'

/**
 * 确保项目目录是一个 git 仓库且有初始提交
 */
export function ensureGitRepo(projectDir: string): void {
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    execSync('git init', { cwd: projectDir, stdio: 'pipe' })
  }

  // Ensure git user config exists (needed for commits in fresh repos)
  try {
    execSync('git config user.email', { cwd: projectDir, stdio: 'pipe' })
  } catch {
    execSync('git config user.email "pipeline-v2@local"', { cwd: projectDir, stdio: 'pipe' })
    execSync('git config user.name "Pipeline V2"', { cwd: projectDir, stdio: 'pipe' })
  }

  // 检查是否有初始提交
  try {
    execSync('git rev-parse HEAD', { cwd: projectDir, stdio: 'pipe' })
  } catch {
    // 没有提交，创建初始提交
    execSync('git add -A && git commit -m "Initial commit" --allow-empty', {
      cwd: projectDir,
      stdio: 'pipe',
    })
  }
}

/**
 * 获取当前分支名
 */
export function getCurrentBranch(projectDir: string): string {
  return execSync('git branch --show-current', {
    cwd: projectDir,
    encoding: 'utf-8',
  }).trim() || 'main'
}

/**
 * 提交所有更改（在指定目录）
 */
export function commitAll(
  dir: string,
  message: string,
): { status: 'committed' | 'no_changes' | 'error'; error?: string } {
  try {
    execSync('git add -A', { cwd: dir, stdio: 'pipe' })
    // 检查是否有更改
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8' })
    if (!status.trim()) return { status: 'no_changes' }

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: dir,
      stdio: 'pipe',
    })
    return { status: 'committed' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr?.toString() || err.message : String(err)
    return { status: 'error', error: msg }
  }
}

/**
 * Check whether the working tree has staged or modified tracked files.
 *
 * Untracked (??) and ignored (!!) files are intentionally excluded:
 * orphan spec files left by a failed pipeline run are untracked and must
 * not block subsequent runs.
 */
export function hasUncommittedChanges(projectDir: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    // Keep only lines that represent staged or modified tracked files.
    return output.split('\n').some(
      line => line.length >= 2 && !line.startsWith('??') && !line.startsWith('!!'),
    )
  } catch {
    return false
  }
}

/**
 * Check whether a local branch already exists.
 */
export function branchExists(projectDir: string, branchName: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
      cwd: projectDir,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Checkout an existing branch (must already exist locally).
 *
 * @returns The branch name (unchanged), for call-site symmetry with createFeatureBranch.
 */
export function checkoutExistingBranch(projectDir: string, branchName: string): string {
  execSync(`git checkout "${branchName}"`, { cwd: projectDir, stdio: 'pipe' })
  return branchName
}

/**
 * Convert an arbitrary string into a valid git branch name component.
 * Lowercases, replaces non-alphanumeric chars with hyphens, collapses
 * repeated hyphens, trims leading/trailing special chars, caps at 50 chars.
 */
export function sanitizeBranchName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 50) || 'change'
  )
}

/**
 * Detect the primary branch (main > master > create main).
 * Does NOT check out the branch — call getCurrentBranch + git checkout yourself.
 */
export function resolveMainBranch(projectDir: string): string {
  for (const candidate of ['master', 'main']) {
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${candidate}`, {
        cwd: projectDir,
        stdio: 'pipe',
      })
      return candidate
    } catch {}
  }

  // Neither main nor master exists.
  // Create a new 'main' branch from HEAD without renaming the current branch.
  execSync('git branch main', { cwd: projectDir, stdio: 'pipe' })
  return 'main'
}

/**
 * Create (and check out) a new feature branch `coding/<sanitized-changeName>`
 * branched from `mainBranch`.  If the branch name is already taken, an
 * ISO-timestamp suffix is appended to ensure uniqueness.
 *
 * Untracked files in the working tree are preserved across the branch switch.
 *
 * @returns The actual branch name that was created.
 */
export function createFeatureBranch(
  projectDir: string,
  changeName: string,
  mainBranch: string,
): string {
  const safe = sanitizeBranchName(changeName)
  let branchName = `coding/${safe}`

  // If the name already exists, append a compact timestamp.
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
      cwd: projectDir,
      stdio: 'pipe',
    })
    branchName = `${branchName}-${Date.now()}`
  } catch {
    // Branch does not exist — name is available.
  }

  // Branch from mainBranch directly; untracked files carry over automatically.
  execSync(`git checkout -b "${branchName}" "${mainBranch}"`, {
    cwd: projectDir,
    stdio: 'pipe',
  })

  return branchName
}
