import type { Field } from 'payload'

export type AiTaskButtonFieldOptions = {
  name: string
  agentTaskId: string | number
  targetPath: string
  label?: string
  inputMappings?: Array<{
    key: string
    fieldPath?: string
    value?: string
  }>
  applyMode?: 'replace' | 'append'
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export function aiTaskButtonField(options: AiTaskButtonFieldOptions): Field {
  return {
    name: options.name,
    type: 'ui',
    admin: {
      disableListColumn: true,
      components: {
        Field: {
          path: '@scaffold/plugin-agent/admin/AiTaskFieldButton#default',
          clientProps: {
            aiTask: {
              agentTaskId: options.agentTaskId,
              targetPath: options.targetPath,
              label: options.label,
              inputMappings: options.inputMappings || [],
              applyMode: options.applyMode || 'replace',
              pollIntervalMs: options.pollIntervalMs,
              pollTimeoutMs: options.pollTimeoutMs,
            },
          },
        },
      },
    },
  }
}
