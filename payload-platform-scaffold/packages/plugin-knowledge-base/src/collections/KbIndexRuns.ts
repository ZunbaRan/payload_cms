import type { CollectionConfig } from 'payload'

/**
 * kb-index-runs
 * 知识库索引运行记录：每次"开始索引"创建一条；
 * 也记录用 agent 抓取来源时的快照（phase=fetching → indexing → done）。
 */
export const KbIndexRuns: CollectionConfig = {
  slug: 'kb-index-runs',
  admin: {
    useAsTitle: 'id',
    group: '知识库',
    defaultColumns: [
      'knowledgeBase',
      'kind',
      'status',
      'phase',
      'progress',
      'totalChunks',
      'embeddedChunks',
      'startedAt',
      'durationMs',
    ],
    description: '查看每次索引/抓取的执行情况',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'knowledgeBase',
      type: 'relationship',
      relationTo: 'knowledge-bases',
      required: true,
      index: true,
    },
    {
      name: 'kind',
      type: 'select',
      defaultValue: 'index',
      options: [
        { label: '索引', value: 'index' },
        { label: 'Agent 抓取', value: 'fetch' },
      ],
      admin: { description: 'index = 切块+向量化；fetch = 用 agent-task 抓取来源' },
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
    {
      name: 'phase',
      type: 'select',
      defaultValue: 'pending',
      options: [
        { label: '等待', value: 'pending' },
        { label: '抓取中', value: 'fetching' },
        { label: '切块', value: 'chunking' },
        { label: '向量化', value: 'embedding' },
        { label: '完成', value: 'done' },
      ],
    },
    {
      name: 'progress',
      type: 'number',
      defaultValue: 0,
      label: '进度（%）',
      admin: { description: '0-100' },
    },
    { name: 'totalChunks', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'embeddedChunks', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'startedAt', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', type: 'date', admin: { readOnly: true } },
    { name: 'durationMs', type: 'number', admin: { readOnly: true } },
    {
      name: 'message',
      type: 'textarea',
      label: '说明 / 错误信息',
      admin: { readOnly: true, rows: 4 },
    },
    {
      name: 'logs',
      type: 'json',
      label: '日志',
      admin: { readOnly: true, description: '执行过程的关键事件' },
    },
    {
      name: 'agentTaskRun',
      type: 'relationship',
      relationTo: 'agent-task-runs',
      label: '关联 Agent Run',
      admin: { description: '当 kind=fetch 时关联到对应 agent-task-run', readOnly: true },
    },
  ],
}
