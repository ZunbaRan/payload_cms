import type { CollectionConfig } from 'payload'

export const Contracts: CollectionConfig = {
  slug: 'contracts',
  admin: {
    useAsTitle: 'title',
    group: '合同管理',
    defaultColumns: ['title', 'status', 'expiresAt', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: '合同名称',
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '待审批', value: 'pending_approval' },
        { label: '生效中', value: 'active' },
        { label: '已到期', value: 'expired' },
        { label: '已终止', value: 'terminated' },
      ],
      label: '状态',
    },
    {
      name: 'counterparty',
      type: 'text',
      label: '对方主体',
    },
    {
      name: 'amount',
      type: 'number',
      label: '合同金额（元）',
    },
    {
      name: 'expiresAt',
      type: 'date',
      label: '到期日期',
    },
    {
      name: 'notes',
      type: 'textarea',
      label: '备注',
    },
  ],
  hooks: {
    beforeRead: [
      ({ doc, req }) => {
        if (req.payloadAPI === 'MCP') {
          req.payload.logger.info(`[contract-plugin] MCP 读取合同: ${doc?.id}`)
        }
        return doc
      },
    ],
  },
}
