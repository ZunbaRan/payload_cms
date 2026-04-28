import type { CollectionConfig } from 'payload'
import { runAgentTaskEndpoint } from '../endpoints/runAgentTask'

/**
 * agent-tasks
 *
 * 配置一个 AI agent 任务：
 *   - 提示词（prompt）
 *   - 关联的 skills（可多选）
 *   - 使用的模型（必须 modelType=text）
 *   - 限制：最大步数、超时
 * "执行" 按钮把它入队 processAgentTaskRun
 */
export const AgentTasks: CollectionConfig = {
  slug: 'agent-tasks',
  admin: {
    useAsTitle: 'name',
    group: 'AI Agent',
    defaultColumns: ['name', 'aiModel', 'lastRunAt', 'lastRunStatus'],
    components: {
      edit: {
        beforeDocumentControls: [
          '@scaffold/plugin-agent/admin/AgentTaskRunButton#default',
        ],
      },
    },
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  endpoints: [runAgentTaskEndpoint],
  fields: [
    { name: 'name', type: 'text', required: true, label: '任务名' },
    {
      name: 'prompt',
      type: 'textarea',
      required: true,
      label: '任务提示词',
      admin: {
        description:
          '直接告诉 agent 要做什么；agent 会根据提示词自主决定调用哪些 skill 和 bash 命令。可使用 {{key}} 占位符引用下方"输入变量"，运行时由调用方传入实际值。',
        rows: 8,
      },
    },
    {
      name: 'variables',
      type: 'array',
      label: '输入变量（prompt 模板）',
      admin: {
        description:
          '声明 prompt 中用到的占位符。例如声明 key=url，prompt 里写 {{url}}，调用 /run 时传 inputs:{url:"https://..."}。',
      },
      fields: [
        { name: 'key', type: 'text', required: true, label: '变量名' },
        { name: 'label', type: 'text', label: '显示名' },
        { name: 'defaultValue', type: 'text', label: '默认值' },
        { name: 'description', type: 'textarea', label: '说明' },
      ],
    },
    {
      name: 'outputMode',
      type: 'select',
      defaultValue: 'text',
      label: '输出模式',
      options: [
        { label: '直接文本（finalOutput=agent 文字答案）', value: 'text' },
        { label: '文件路径（finalOutput=绝对路径，调用方自行读取）', value: 'file' },
      ],
      admin: {
        description:
          '当被 KB「用 Agent 抓取」调用时，会强制按 file 模式：要求 agent 把抓到的内容写到 ./workspace/output.md 并返回绝对路径',
      },
    },
    {
      name: 'skills',
      type: 'relationship',
      relationTo: 'agent-skills',
      hasMany: true,
      label: '关联 Skills',
      filterOptions: () => ({ isActive: { equals: true } }),
      admin: {
        description: '只显示已上架的 skill',
      },
    },
    {
      name: 'aiModel',
      type: 'relationship',
      relationTo: 'ai-models',
      required: true,
      label: 'AI 模型',
      filterOptions: () => ({
        modelType: { equals: 'text' },
        isActive: { equals: true },
      }),
    },
    {
      name: 'maxSteps',
      type: 'number',
      defaultValue: 20,
      label: '最大步数',
      admin: { description: 'agent loop 最多执行多少轮工具调用', position: 'sidebar' },
    },
    {
      name: 'timeoutMs',
      type: 'number',
      defaultValue: 5 * 60 * 1000,
      label: '超时(ms)',
      admin: { position: 'sidebar' },
    },
    {
      name: 'enableBash',
      type: 'checkbox',
      defaultValue: true,
      label: '允许执行 bash',
      admin: {
        description:
          '✓ 给 agent 一个 bash 工具可执行任意命令（沙箱在 .geoflow-data/agent-runs/<id> 内）。⚠ 完全放行权限',
        position: 'sidebar',
      },
    },
    {
      name: 'lastRunAt',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar' },
      label: '上次运行',
    },
    {
      name: 'lastRunStatus',
      type: 'select',
      options: [
        { label: '未运行', value: 'idle' },
        { label: '排队中', value: 'queued' },
        { label: '运行中', value: 'running' },
        { label: '成功', value: 'success' },
        { label: '失败', value: 'failed' },
      ],
      defaultValue: 'idle',
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'totalRuns',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
