import type { CollectionConfig } from 'payload'
import { AGENT_ROLES } from '../types'

/** Agent 角色（planner/coder/tester/reflector/memory） */
export const AgentRoles: CollectionConfig = {
  slug: 'pipeline-agent-roles',
  admin: { group: 'Coding Pipeline · Config', useAsTitle: 'slug' },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'role', type: 'select', required: true,
      options: AGENT_ROLES.map((r) => ({ label: r, value: r })) },
    { name: 'displayName', type: 'text' },
    { name: 'defaultModel', type: 'relationship', relationTo: 'pipeline-models', required: true },
    { name: 'activePrompt', type: 'relationship', relationTo: 'pipeline-prompt-templates',
      admin: { description: 'Currently active prompt version for this role' } },
    { name: 'allowedTools', type: 'array', fields: [{ name: 'tool', type: 'text' }] },
    { name: 'allowedSkills', type: 'relationship', relationTo: 'pipeline-skills', hasMany: true },
    { name: 'permissionMode', type: 'select', defaultValue: 'acceptEdits',
      options: ['default', 'acceptEdits', 'dontAsk', 'bypassPermissions', 'auto'] },
    { name: 'maxTurns', type: 'number', defaultValue: 60 },
    { name: 'maxBudgetUsd', type: 'number' },
  ],
}
