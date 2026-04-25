# 用 Payload CMS 构建插件化数字员工系统

> 来自同事分享的架构思路，结合自己的理解整理。

---

## 核心思路

**用 Payload CMS 当"平台内核"，用插件机制扩展各个业务模块，再通过 MCP 把这些模块暴露给 AI Agent（数字员工）去调用。**

类比 VSCode：

| VSCode | 这套架构 |
|---|---|
| VSCode 核心 | Payload CMS 通用服务（一个中心实例） |
| VSCode 插件 | 业务 Plugin（合同管理 / 案件管理） |
| 插件安装 | `npm install @company/contract-plugin` |
| 插件能力 | Collections（数据结构）+ MCP Tools（AI 可调用的操作） |
| 用户 | 数字员工（AI Agent） |

---

## 系统架构图

```
┌─────────────────────────────────────────────┐
│          数字员工（AI Agent）               │
│     通过 MCP 协议调用工具来完成任务          │
└──────────────┬──────────────────────────────┘
               │ MCP 调用
┌──────────────▼──────────────────────────────┐
│         Payload CMS 通用服务                 │
│  ┌────────────────┐  ┌──────────────────┐   │
│  │ 合同管理 Plugin │  │ 案件管理 Plugin   │   │
│  │ - Collections  │  │ - Collections    │   │
│  │ - MCP Tools   │  │ - MCP Tools      │   │
│  │ - Skill 定义  │  │ - Skill 定义     │   │
│  └────────────────┘  └──────────────────┘   │
│                                              │
│  [统一的 Admin UI / 权限 / 数据库]           │
└─────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│              数据库（PostgreSQL）            │
└─────────────────────────────────────────────┘
```

---

## 每层的职责

### Payload CMS 通用服务层
- 一个共用的 Payload 实例，不是每个业务单独一套
- 提供统一的 Admin UI、权限系统、数据库连接
- 安装各业务的 Plugin

### 业务 Plugin 层（以合同管理为例）

一个 Plugin 主要做三件事：

**1. 注册 Collections（数据结构）**
```typescript
// contract-plugin/src/collections/Contract.ts
export const Contract: CollectionConfig = {
  slug: 'contracts',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'status', type: 'select', options: ['draft', 'active', 'expired'] },
    { name: 'parties', type: 'relationship', relationTo: 'companies', hasMany: true },
    { name: 'expiresAt', type: 'date' },
  ],
}
```

**2. 暴露 MCP Tools（AI 可调用的操作）**
```typescript
// contract-plugin/src/mcp/tools.ts
tools: [
  {
    name: 'searchContracts',
    description: '根据条件搜索合同',
    handler: async (args, req) => {
      const results = await req.payload.find({
        collection: 'contracts',
        where: { status: { equals: args.status } },
      })
      return results
    },
    parameters: z.object({
      status: z.enum(['draft', 'active', 'expired']),
    }),
  },
  {
    name: 'createContractDraft',
    description: '创建合同草稿',
    handler: async (args, req) => {
      return await req.payload.create({
        collection: 'contracts',
        data: args,
      })
    },
    parameters: z.object({ title: z.string(), parties: z.array(z.string()) }),
  },
]
```

**3. 定义 Skill（给 Agent 用的高层能力）**

MCP Tool 是原子操作，Skill 是组合多个 Tool 完成一个业务目标，例如：
- Skill：`处理合同到期提醒` = 查询即将到期合同 + 生成提醒邮件内容 + 发送通知

### 数字员工（Agent）层
- 通过 MCP 协议连接 Payload 服务
- 调用各 Plugin 暴露的 Tool 完成用户请求
- 不直接操作数据库，通过 MCP 隔离

---

## Plugin 安装流程

理想中的安装体验（类似 VSCode 插件）：

```bash
# 安装合同管理插件
npm install @company/payload-plugin-contract

# 在 payload.config.ts 中注册
import { contractPlugin } from '@company/payload-plugin-contract'

export default buildConfig({
  plugins: [
    contractPlugin({
      enableMCP: true,        // 暴露 MCP 接口
      enableWorkflow: true,   // 启用审批流
    }),
  ],
})
```

执行 `payload migrate` 后，合同相关的数据库表自动建好，Admin UI 自动出现合同管理菜单，MCP Server 自动暴露合同相关的 Tool。

---

## 这套架构的优势

| 维度 | 传统做法 | 这套架构 |
|---|---|---|
| 新增业务模块 | 单独开发一套系统 | 开发一个 Plugin，安装进通用服务 |
| AI 接入业务 | 对接各家不同 API | 统一 MCP 协议 |
| 权限管理 | 各系统各自管 | Payload 统一权限层 |
| Admin UI | 各系统各自建 | 自动生成，统一风格 |
| 数据互通 | 跨系统数据难关联 | 同一个数据库，Collection 间可关联 |

---

## 待追问的问题

下次找同事深聊时，要问清楚：

1. **数字员工是什么技术实现？** Dify？自研 Agent Runtime？还是直接接 Claude API？
2. **Plugin 是 npm 包形式吗？** 还是有自己的 CLI 工具管理？
3. **Skill 和 MCP Tool 是什么关系？** Skill 是更高层的抽象吗？
4. **同一个 Payload 实例承载多业务，数据隔离怎么做？** 多租户方案？
5. **"比较重的 tool"具体指什么？** 是指带状态机/审批流的复杂业务逻辑吗？
