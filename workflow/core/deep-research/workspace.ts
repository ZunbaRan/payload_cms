/**
 * @fileoverview Deep Research workspace setup.
 *
 * 每个 deep-research 任务创建一个独立工作区文件夹：
 * - .claude/skills/ 下放置搜索 Agent 所需 skill 的符号链接
 * - materials/search/ 和 materials/seeds/ 用于保存抓取的 Markdown
 * - INDEX.md 和 search-plan.json 用于输出
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SearchWorkspace } from './types.js'

// ---------------------------------------------------------------------------
// Skill 定义：搜索 Agent 需要的 skill
// ---------------------------------------------------------------------------

/**
 * 搜索 Agent 依赖的 user-level skill 名称列表。
 * 这些 skill 位于 ~/.agents/skills/ 或项目内 src/skill_hub/ 目录下。
 */
const SEARCH_SKILLS = [
  'web-access',
  'markdown-proxy',
  'metaso-search',
  'paper-download',
] as const

// ---------------------------------------------------------------------------
// Workspace Creation
// ---------------------------------------------------------------------------

/**
 * 将目标文本清洗为安全的目录名。
 */
export function sanitizeDirectoryName(text: string, maxLen = 60): string {
  return text
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')   // 保留字母数字中文连字符空格
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .toLowerCase() || 'research'
}

/**
 * 创建 deep-research 工作区。
 *
 * @param rootDir - 工作区根目录
 * @param skillHubDir - 可选，项目内 skill_hub 目录路径。优先使用此目录安装 skill。
 * @returns 初始化后的 SearchWorkspace 描述
 */
export function createSearchWorkspace(rootDir: string, skillHubDir?: string): SearchWorkspace {
  const materialsDir = path.join(rootDir, 'materials')
  const searchDir = path.join(materialsDir, 'search')
  const seedsDir = path.join(materialsDir, 'seeds')
  const booksDir = path.join(materialsDir, 'books')
  const skillsDir = path.join(rootDir, '.claude', 'skills')
  const indexPath = path.join(rootDir, 'INDEX.md')
  const referenceIndexPath = path.join(rootDir, 'index-reference.md')
  const planPath = path.join(rootDir, 'search-plan.json')

  // 创建目录结构
  for (const dir of [searchDir, seedsDir, booksDir, skillsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // 安装搜索 skill（符号链接到 user-level skill 目录）
  installSearchSkills(skillsDir, skillHubDir)

  return { rootDir, materialsDir, searchDir, seedsDir, booksDir, skillsDir, indexPath, referenceIndexPath, planPath }
}

// ---------------------------------------------------------------------------
// Skill Installation
// ---------------------------------------------------------------------------

/**
 * 解析 user-level skill 的源目录。
 * 支持 ~/.agents/skills/ (Claude Code) 和 ~/.claude/skills/ (旧路径) 两种。
 */
function resolveUserSkillsDir(): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const candidates = [
    path.join(home, '.agents', 'skills'),
    path.join(home, '.claude', 'skills'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return undefined
}

/**
 * 将搜索 skill 以符号链接的形式安装到工作区的 .claude/skills/ 目录。
 *
 * 查找优先级：skillHubDir（项目内 skill_hub）> ~/.agents/skills/ > ~/.claude/skills/
 */
function installSearchSkills(targetSkillsDir: string, skillHubDir?: string): void {
  // 构建候选源目录列表
  const candidates: string[] = []
  if (skillHubDir && fs.existsSync(skillHubDir)) candidates.push(skillHubDir)
  const userDir = resolveUserSkillsDir()
  if (userDir) candidates.push(userDir)

  if (candidates.length === 0) return

  for (const skillName of SEARCH_SKILLS) {
    const destDir = path.join(targetSkillsDir, skillName)
    if (fs.existsSync(destDir)) continue

    // 从候选目录中找到第一个存在的 skill
    const srcDir = candidates.map(d => path.join(d, skillName)).find(p => fs.existsSync(p))
    if (!srcDir) continue

    try {
      fs.symlinkSync(srcDir, destDir, 'dir')
    } catch {
      // symlink 失败（Windows 或权限问题），尝试复制 SKILL.md
      try {
        fs.mkdirSync(destDir, { recursive: true })
        const skillMd = path.join(srcDir, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          fs.copyFileSync(skillMd, path.join(destDir, 'SKILL.md'))
        }
      } catch { /* best effort */ }
    }
  }
}
