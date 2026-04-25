# Payload CMS 通用服务搭建 & 插件设计

> 基于官方文档整理：  
> - https://payloadcms.com/docs/getting-started/installation  
> - https://payloadcms.com/docs/configuration/overview  
> - https://payloadcms.com/docs/plugins/overview  
> - https://payloadcms.com/docs/plugins/build-your-own  
> - https://payloadcms.com/docs/plugins/plugin-api  
> - https://payloadcms.com/docs/plugins/mcp  

---

## 一、通用服务应该怎么搭建

### 1.1 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 20.9.0+ |
| Next.js | 15.2.x / 15.3.x / 15.4.x / 16.2.2+ |
| 数据库 | MongoDB / PostgreSQL / SQLite |
| 包管理器 | pnpm（推荐）/ npm / yarn 2+ |

### 1.2 从零创建通用服务

```bash
# 方式一：直接用脚手架（最快）
npx create-payload-app

# 方式二：安装到已有 Next.js 项目
pnpm i payload @payloadcms/next

# 数据库 Adapter（选其一）
pnpm i @payloadcms/db-postgres   # PostgreSQL（推荐用于生产）
pnpm i @payloadcms/db-mongodb    # MongoDB

# 可选：富文本编辑器 / 图片处理
pnpm i @payloadcms/richtext-lexical sharp
```

### 1.3 目录结构

Payload 安装在 Next.js 的 `/app` 目录下，两者共存：

```
my-platform/
├── app/
│   ├── (payload)/          # Payload 核心文件（不需要改，从模板复制）
│   │   ├── admin/
│   │   ├── api/
│   │   └── ...
│   └── (frontend)/         # 你自己的前端（如有）
├── payload.config.ts        # ← 核心配置文件，所有配置都在这里
├── next.config.mjs
└── package.json
```

### 1.4 最小可用的 `payload.config.ts`

这是通用服务的核心文件，**所有业务 Plugin 都注册在这里**：

```typescript
import sharp from 'sharp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import { mcpPlugin } from '@payloadcms/plugin-mcp'

export default buildConfig({
  // ── 基础配置 ──────────────────────────────────
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',

  // ── 数据库 ─────────────────────────────────────
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
  }),

  // ── 编辑器 ─────────────────────────────────────
  editor: lexicalEditor(),
  sharp,

  // ── 内置 Collections（平台基础数据）────────────
  collections: [
    // 用户/权限管理等平台级 Collection 放这里
    // 各业务 Plugin 自己的 Collection 由 Plugin 注入，不需要手动写
  ],

  // ── 插件列表 ────────────────────────────────────
  // 每安装一个业务 Plugin，就在这里加一行
  plugins: [
    // 1. MCP Plugin：把整个服务暴露为 MCP Server
    mcpPlugin({
      collections: {
        // 按需开放各 Collection 的 AI 操作权限
        // contracts: { enabled: true },
        // cases: { enabled: { find: true, create: true } },
      },
      mcp: {
        tools: [], // 自定义 Tool 也可以在这里全局注册
      },
    }),

    // 2. 业务 Plugin（每个 Plugin 一行）
    // contractPlugin({ enableMCP: true }),
    // casePlugin({ enableMCP: true }),
  ],

  // ── Admin UI ────────────────────────────────────
  admin: {
    user: 'users', // 使用哪个 Collection 来做认证
  },
})
```

### 1.5 启动服务

```bash
# 开发模式
pnpm dev

# 数据库迁移（每次更改 Collection 定义后执行）
pnpm payload migrate

# 访问 Admin UI
open http://localhost:3000/admin
```

---

## 二、插件机制应该怎么设计

### 2.1 Payload Plugin 的本质

**一句话：Plugin 是一个函数，接收旧 Config，返回新 Config。**

```typescript
// 最简单的 Plugin 签名
type Plugin = (incomingConfig: Config) => Config
```

Payload 官方推荐用 `definePlugin` 封装（更规范、支持跨 Plugin 通信）：

```typescript
import { definePlugin } from 'payload'

export const contractPlugin = definePlugin<ContractPluginOptions>({
  slug: 'plugin-contract',  // 唯一标识，用于跨 Plugin 通信
  order: 10,                // 执行顺序（越小越先执行）
  plugin: ({ config, ...options }) => {
    // 修改 config 并返回
    return {
      ...config,
      collections: [...(config.collections || []), ContractCollection],
    }
  },
})
```

### 2.2 Plugin 执行顺序

```
1. 验证传入的 config
2. ← 所有 Plugin 在这里执行（按 order 顺序）
3. 合并默认选项
4. 数据清理和验证
5. 初始化最终 config
```

### 2.3 业务 Plugin 的完整结构

以**合同管理 Plugin** 为例，推荐的文件结构：

```
packages/plugin-contract/
├── src/
│   ├── index.ts               # 入口，export contractPlugin
│   ├── collections/
│   │   └── Contracts.ts       # Collection 定义
│   ├── mcp/
│   │   └── tools.ts           # 自定义 MCP Tool
│   └── types.ts               # Plugin 选项类型
├── dev/                       # 本地开发/测试环境
│   └── payload.config.ts
└── package.json
```

#### 入口 `src/index.ts`

```typescript
import { definePlugin } from 'payload'
import type { Config } from 'payload'
import { ContractCollection } from './collections/Contracts'
import { contractMcpTools } from './mcp/tools'
import type { ContractPluginOptions } from './types'

export const contractPlugin = definePlugin<ContractPluginOptions>({
  slug: 'plugin-contract',
  order: 10,
  plugin: ({ config, enableMCP = true, enableWorkflow = false }) => {
    // 1. 注入 Collection
    const updatedConfig: Config = {
      ...config,
      collections: [
        ...(config.collections || []),
        ContractCollection,
      ],
    }

    // 2. 注入 MCP Tools（如果启用）
    if (enableMCP) {
      const existingPlugins = updatedConfig.plugins || []
      // 找到已有的 mcpPlugin，注入自定义 Tool
      // 注意：mcpPlugin 需要在此 Plugin 之前已注册（order 更小）
      updatedConfig.plugins = [
        ...existingPlugins,
        // 可以通过 plugins map 通信（见下文）
      ]
    }

    // 3. 扩展 onInit（用于初始化逻辑）
    updatedConfig.onInit = async (payload) => {
      if (config.onInit) await config.onInit(payload)
      // Plugin 自己的初始化逻辑
    }

    return updatedConfig
  },
})

// 向 Payload 的类型系统注册，使跨 Plugin 通信时有类型提示
declare module 'payload' {
  interface RegisteredPlugins {
    'plugin-contract': ContractPluginOptions
  }
}
```

#### Collection 定义 `src/collections/Contracts.ts`

```typescript
import type { CollectionConfig } from 'payload'

export const ContractCollection: CollectionConfig = {
  slug: 'contracts',
  admin: {
    useAsTitle: 'title',
    group: '合同管理',  // Admin UI 侧边栏分组
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'title', type: 'text', required: true, label: '合同名称' },
    {
      name: 'status',
      type: 'select',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '生效中', value: 'active' },
        { label: '已到期', value: 'expired' },
        { label: '已终止', value: 'terminated' },
      ],
      defaultValue: 'draft',
    },
    { name: 'expiresAt', type: 'date', label: '到期日期' },
    { name: 'content', type: 'richText', label: '合同正文' },
  ],
  // MCP 相关 Hook：可区分请求来源
  hooks: {
    beforeRead: [
      ({ doc, req }) => {
        if (req.payloadAPI === 'MCP') {
          // 通过 MCP 调用时的特殊处理
        }
        return doc
      },
    ],
  },
}
```

#### MCP Tools `src/mcp/tools.ts`

```typescript
import { z } from 'zod'

// 这些是"比较重的 Tool"——封装复杂业务逻辑
export const contractMcpTools = [
  {
    name: 'searchExpiringContracts',
    description: '查找即将在指定天数内到期的合同，用于到期提醒',
    parameters: z.object({
      daysAhead: z.number().describe('未来多少天内到期'),
    }),
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
        overrideAccess: false,  // 继承 API Key 的权限
        user: req.user,
      })

      return {
        content: [{
          type: 'text',
          text: `找到 ${results.totalDocs} 份将在 ${args.daysAhead} 天内到期的合同：\n${
            results.docs.map(c => `- ${c.title}（到期：${c.expiresAt}）`).join('\n')
          }`,
        }],
      }
    },
  },

  {
    name: 'submitContractForApproval',
    description: '将草稿合同提交审批流程',
    parameters: z.object({
      contractId: z.string().describe('合同 ID'),
      notes: z.string().optional().describe('提交备注'),
    }),
    handler: async (args: { contractId: string; notes?: string }, req: any) => {
      const { payload } = req
      await payload.update({
        collection: 'contracts',
        id: args.contractId,
        data: { status: 'pending_approval' },
        req,
        overrideAccess: false,
      })
      return {
        content: [{ type: 'text', text: `合同已提交审批，ID: ${args.contractId}` }],
      }
    },
  },
]
```

### 2.4 在通用服务中注册 Plugin + MCP Tools

```typescript
// payload.config.ts
import { buildConfig } from 'payload'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { contractPlugin } from '@company/payload-plugin-contract'
import { contractMcpTools } from '@company/payload-plugin-contract/mcp'
import { casePlugin } from '@company/payload-plugin-case'
import { caseMcpTools } from '@company/payload-plugin-case/mcp'

export default buildConfig({
  // ...基础配置...

  plugins: [
    // MCP Plugin 先注册（order 低），业务 Plugin 后注册
    mcpPlugin({
      collections: {
        contracts: {
          enabled: { find: true, create: true, update: true },
          description: '企业合同管理，包含合同全生命周期数据',
        },
        cases: {
          enabled: { find: true, create: true, update: true },
          description: '法律案件管理，包含案件进度和相关文书',
        },
      },
      mcp: {
        // 业务 Plugin 的"重型 Tool"汇总注册
        tools: [
          ...contractMcpTools,
          ...caseMcpTools,
        ],
      },
    }),

    contractPlugin({ enableMCP: true, enableWorkflow: true }),
    casePlugin({ enableMCP: true }),
  ],
})
```

### 2.5 跨 Plugin 通信（高级）

当多个 Plugin 需要互相感知时，用 `definePlugin` 的 `plugins` map：

```typescript
// 案件 Plugin 感知合同 Plugin 是否已安装
export const casePlugin = definePlugin<CasePluginOptions>({
  slug: 'plugin-case',
  order: 20,  // 在合同 Plugin（order 10）之后运行
  plugin: ({ config, plugins }) => {
    // 检查合同 Plugin 是否安装
    if (plugins['plugin-contract']) {
      // 如果合同 Plugin 存在，可以在案件的 Collection 里加一个关联字段
      // 例如：案件关联合同
    }
    return {
      ...config,
      collections: [...(config.collections || []), CaseCollection],
    }
  },
})
```

### 2.6 Plugin 开发工作流

```bash
# 用官方模板创建新 Plugin
npx create-payload-app@latest --template plugin

# Plugin 项目里有 dev/ 目录，是独立的 Payload 实例，用于本地测试
cd dev && pnpm dev

# 开发完成后发布到 npm（内部可以发到私有 registry）
npm publish --registry https://your-private-registry.com
```

---

## 三、完整注册流程对照

```
安装业务 Plugin
    │
    ▼
npm install @company/payload-plugin-contract
    │
    ▼
在 payload.config.ts 的 plugins[] 加一行
contractPlugin({ enableMCP: true })
    │
    ▼
pnpm payload migrate
    │
    ├── contracts 表自动创建 ✓
    ├── Admin UI 出现"合同管理"菜单 ✓
    └── MCP Server 暴露 contracts 的 find/create/update Tool ✓
```

---

## 四、关键 API 速查

| 场景 | API |
|---|---|
| Plugin 接收/返回 Config | `(incomingConfig: Config): Config` |
| 推荐写法（含 order/cross-plugin） | `definePlugin({ slug, order, plugin })` |
| 注入 Collection | `config.collections = [...(config.collections \|\| []), NewCollection]` |
| 注入 Global | `config.globals = [...(config.globals \|\| []), NewGlobal]` |
| 注入 Hook | `config.hooks = { ...config.hooks, beforeOperation: [...] }` |
| 扩展 onInit | `config.onInit = async payload => { await incomingConfig.onInit?.(payload); /* 自己的逻辑 */ }` |
| 注册 MCP Tool | `mcpPlugin({ mcp: { tools: [...] } })` |
| 区分 MCP 请求 | `req.payloadAPI === 'MCP'` |
| MCP Tool 调用 Payload | `req.payload.find / create / update / delete` |
| 跨 Plugin 通信 | `plugins['other-plugin-slug']?.options?.someField` |

---

## 参考

- [安装文档](https://payloadcms.com/docs/getting-started/installation)
- [Config 总览](https://payloadcms.com/docs/configuration/overview)
- [插件概述](https://payloadcms.com/docs/plugins/overview)
- [编写你自己的插件](https://payloadcms.com/docs/plugins/build-your-own)
- [高级 Plugin API (definePlugin)](https://payloadcms.com/docs/plugins/plugin-api)
- [MCP Plugin 官方文档](https://payloadcms.com/docs/plugins/mcp)
- [Plugin 模板](https://github.com/payloadcms/payload/tree/3.x/templates/plugin)
