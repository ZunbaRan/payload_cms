import type { GlobalConfig } from 'payload'

/**
 * AiConfig Global — Finly 模式复刻
 *
 * 在 Admin UI 中集中管理：
 *  - 全局默认模型
 *  - 各场景的 Prompt 模板（支持 {{变量}} 占位符）
 *  - 各场景的 maxTokens
 *
 * 读取方式：
 *   const cfg = await payload.findGlobal({ slug: 'ai-config', overrideAccess: true })
 */
export const AiConfig: GlobalConfig = {
  slug: 'ai-config',
  label: 'AI 配置',
  admin: {
    group: 'AI 管理',
    description: '修改后无需重新部署，下次 AI 调用即时生效。',
  },
  access: {
    read: () => true,
    update: ({ req }: any) => Boolean(req.user),
  },
  fields: [
    {
      name: 'modelId',
      type: 'text',
      label: '全局默认模型 ID',
      required: true,
      defaultValue: 'claude-3-5-haiku-20241022',
      admin: {
        description: '各场景可在下方单独覆盖。例如：gpt-4o、deepseek-v4-flash。',
      },
    },
    // ─── 标签生成 ──────────────────────────────────────────────────────────────
    {
      name: 'generateTags',
      type: 'group',
      label: '📌 标签生成',
      fields: [
        {
          name: 'modelId',
          type: 'text',
          label: '模型（留空则使用全局默认）',
        },
        {
          name: 'maxTokens',
          type: 'number',
          label: '最大 Token 数',
          defaultValue: 200,
          min: 50,
          max: 2000,
        },
        {
          name: 'prompt',
          type: 'textarea',
          label: 'Prompt 模板',
          required: true,
          defaultValue:
            '你是一个标签提取助手。根据以下笔记，输出 3 到 6 个精炼的中文标签（每个 2-6 字），' +
            '用 JSON 数组格式返回，只输出 JSON，不要任何解释。\n\n' +
            '标题：{{title}}\n\n' +
            '内容：\n{{content}}\n\n' +
            '示例输出：["架构", "Payload", "插件机制"]',
          admin: { rows: 8 },
        },
      ],
    },
    // ─── 重要性判断 ────────────────────────────────────────────────────────────
    {
      name: 'classifyImportance',
      type: 'group',
      label: '⭐ 重要性判断',
      fields: [
        {
          name: 'modelId',
          type: 'text',
          label: '模型（留空则使用全局默认）',
        },
        {
          name: 'maxTokens',
          type: 'number',
          label: '最大 Token 数',
          defaultValue: 120,
          min: 50,
          max: 500,
        },
        {
          name: 'prompt',
          type: 'textarea',
          label: 'Prompt 模板',
          required: true,
          defaultValue:
            '判断这条笔记对用户是否"重要"（涉及关键决策/截止日/核心洞见/需要后续跟进则算重要）。' +
            '只输出 JSON：{"important": true/false, "reason": "一句话理由（20字内）"}。\n\n' +
            '标题：{{title}}\n内容：{{content}}',
          admin: { rows: 6 },
        },
      ],
    },
    // ─── 文档摘要 ──────────────────────────────────────────────────────────────
    {
      name: 'summarizeDocument',
      type: 'group',
      label: '📄 文档摘要',
      fields: [
        {
          name: 'modelId',
          type: 'text',
          label: '模型（留空则使用全局默认）',
        },
        {
          name: 'maxTokens',
          type: 'number',
          label: '最大 Token 数',
          defaultValue: 600,
          min: 100,
          max: 4000,
        },
        {
          name: 'prompt',
          type: 'textarea',
          label: 'Prompt 模板',
          required: true,
          defaultValue:
            '总结以下文档，输出 JSON（不要其他内容）：' +
            '{"summary": "3-5句话中文摘要", "keywords": ["关键词1", "关键词2", ...最多5个]}\n\n' +
            '文档内容：\n{{content}}',
          admin: { rows: 6 },
        },
      ],
    },
  ],
}
