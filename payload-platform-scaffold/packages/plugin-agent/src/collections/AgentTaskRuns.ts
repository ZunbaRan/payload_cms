import type { CollectionConfig } from 'payload'

/**
 * agent-task-runs
 * 每次执行 agent-task 的快照：步骤、最终输出、token 用量、错误
 */
export const AgentTaskRuns: CollectionConfig = {
  slug: 'agent-task-runs',
  admin: {
    useAsTitle: 'id',
    group: 'AI Agent',
    defaultColumns: ['agentTask', 'status', 'startedAt', 'durationMs', 'totalTokens'],
    description: '查看每次 agent 任务的执行细节',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'agentTask',
      type: 'relationship',
      relationTo: 'agent-tasks',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'queued',
      options: [
        { label: '排队中', value: 'queued' },
        { label: '运行中', value: 'running' },
        { label: '成功', value: 'success' },
        { label: '失败', value: 'failed' },
      ],
      index: true,
    },
    { name: 'startedAt', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', type: 'date', admin: { readOnly: true } },
    { name: 'durationMs', type: 'number', admin: { readOnly: true } },
    {
      name: 'finalOutput',
      type: 'textarea',
      label: '最终输出',
      admin: { readOnly: true, rows: 8 },
    },
    {
      name: 'errorMessage',
      type: 'textarea',
      label: '错误信息',
      admin: { readOnly: true },
    },
    {
      name: 'steps',
      type: 'json',
      label: '执行轨迹',
      admin: { readOnly: true, description: 'agent 每一步的 tool call / result' },
    },
    { name: 'stepCount', type: 'number', admin: { readOnly: true } },
    { name: 'totalTokens', type: 'number', admin: { readOnly: true } },
    { name: 'promptTokens', type: 'number', admin: { readOnly: true } },
    { name: 'completionTokens', type: 'number', admin: { readOnly: true } },
  ],
}
