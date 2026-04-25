import { z } from 'zod'

/**
 * 合同相关的 MCP Tools
 * 这些是"比较重的 Tool" —— 封装了标准 CRUD 之外的业务逻辑。
 * 由平台主配置在 mcpPlugin({ mcp: { tools: [...] } }) 中注入。
 */
export const contractMcpTools = [
  {
    name: 'searchExpiringContracts',
    description:
      '查找在未来 N 天内到期且仍在生效中的合同，用于合同到期提醒。返回合同标题、到期日期和对方主体。',
    parameters: z.object({
      daysAhead: z.number().int().positive().describe('未来多少天内到期，例如 30 表示 30 天内'),
    }).shape,
    handler: async (args: { daysAhead: number }, req: any) => {
      const { payload } = req
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + args.daysAhead)

      const results = await payload.find({
        collection: 'contracts',
        where: {
          and: [
            { status: { equals: 'active' } },
            { expiresAt: { less_than: expiryDate.toISOString() } },
          ],
        },
        req,
        overrideAccess: false,
        user: req.user,
        limit: 100,
      })

      if (results.totalDocs === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `未来 ${args.daysAhead} 天内没有即将到期的生效中合同。`,
            },
          ],
        }
      }

      const lines = results.docs
        .map(
          (c: any) =>
            `- ${c.title}（对方: ${c.counterparty ?? '未填写'}，到期: ${c.expiresAt ?? '未填写'}）`,
        )
        .join('\n')

      return {
        content: [
          {
            type: 'text' as const,
            text: `找到 ${results.totalDocs} 份将在 ${args.daysAhead} 天内到期的生效中合同：\n${lines}`,
          },
        ],
      }
    },
  },

  {
    name: 'submitContractForApproval',
    description: '将一份草稿状态的合同提交审批。仅当合同当前状态为 draft 时允许操作。',
    parameters: z.object({
      contractId: z.string().describe('合同 ID（数据库主键）'),
      notes: z.string().optional().describe('提交审批时的备注信息，可选'),
    }).shape,
    handler: async (args: { contractId: string; notes?: string }, req: any) => {
      const { payload } = req
      const existing = await payload.findByID({
        collection: 'contracts',
        id: args.contractId,
        req,
        overrideAccess: false,
        user: req.user,
      })

      if (!existing) {
        return {
          content: [{ type: 'text' as const, text: `未找到 ID 为 ${args.contractId} 的合同。` }],
          isError: true,
        }
      }

      if (existing.status !== 'draft') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `合同 "${existing.title}" 当前状态为 ${existing.status}，不允许提交审批（仅草稿可提交）。`,
            },
          ],
          isError: true,
        }
      }

      const updated = await payload.update({
        collection: 'contracts',
        id: args.contractId,
        data: {
          status: 'pending_approval',
          notes: args.notes
            ? `${existing.notes ? existing.notes + '\n' : ''}[提交审批] ${args.notes}`
            : existing.notes,
        },
        req,
        overrideAccess: false,
        user: req.user,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: `合同 "${updated.title}" 已提交审批，状态变更为 pending_approval。`,
          },
        ],
      }
    },
  },
]
