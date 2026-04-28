import type { CollectionConfig } from 'payload'

export const WorkerHeartbeats: CollectionConfig = {
  slug: 'worker-heartbeats',
  admin: {
    useAsTitle: 'workerId',
    group: '任务调度',
    defaultColumns: ['workerId', 'status', 'lastHeartbeatAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'workerId', type: 'text', required: true, unique: true, label: 'Worker ID' },
    { name: 'queue', type: 'text', label: '队列名' },
    { name: 'hostname', type: 'text', label: '主机名' },
    { name: 'pid', type: 'number', label: 'PID' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'idle',
      options: [
        { label: '空闲', value: 'idle' },
        { label: '处理中', value: 'busy' },
        { label: '离线', value: 'offline' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'lastHeartbeatAt', type: 'date', label: '最后心跳' },
    { name: 'metrics', type: 'json', label: '指标' },
  ],
}
