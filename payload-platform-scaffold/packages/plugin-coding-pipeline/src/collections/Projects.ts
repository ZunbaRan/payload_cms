import type { CollectionConfig } from 'payload'

/** 目标 git 仓库 */
export const Projects: CollectionConfig = {
  slug: 'pipeline-projects',
  admin: { group: 'Coding Pipeline · Workspace', useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
    { name: 'gitRepoPath', type: 'text', required: true,
      admin: { description: 'Absolute path to a git worktree on this host' } },
    { name: 'mainBranch', type: 'text', defaultValue: 'main' },
    { name: 'claudeMd', type: 'code',
      admin: { language: 'markdown',
        description: 'Will be written to <repo>/CLAUDE.md before each phase' } },
    { name: 'env', type: 'json',
      admin: { description: 'Extra env vars passed to ClaudeAgent (object of string→string)' } },
  ],
}
