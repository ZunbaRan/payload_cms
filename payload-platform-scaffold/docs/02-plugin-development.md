# 插件开发规范

## 插件命名

内部业务插件使用 workspace package：

```text
@scaffold/plugin-notes
@scaffold/plugin-tasks
@scaffold/plugin-ai
@scaffold/plugin-documents
```

迁移到真实项目时，把 `@scaffold` 替换为项目命名空间，例如：

```text
@mvp/plugin-notes
@finly/plugin-ai
@company/plugin-crm
```

## 基本结构

```text
packages/plugin-example/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    └── collections/
        └── Examples.ts
```

## package.json 模板

```json
{
  "name": "@scaffold/plugin-example",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@scaffold/shared": "workspace:*"
  },
  "peerDependencies": {
    "payload": "^3.0.0"
  }
}
```

## 插件入口规范

插件入口必须返回 Payload `Plugin`：

```ts
import type { Config, Plugin } from 'payload'
import { Examples } from './collections/Examples'

export interface ExamplePluginOptions {
  enabled?: boolean
}

export const examplePlugin =
  (options: ExamplePluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig

    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Examples],
    }
  }
```

## 插件应该封装什么

一个完整业务插件可以封装：

- Collections
- Globals
- Jobs Queue tasks / workflows
- Access control helpers
- Hooks
- Admin components
- Custom endpoints
- Seed data
- MCP 自定义 tools / resources / prompts 的配置片段

## 插件不应该做什么

- 不直接启动服务器
- 不持有数据库 adapter
- 不修改平台级 `secret`
- 不直接引入 Next.js 页面，除非是特定 Admin custom view
- 不默认暴露所有能力给 MCP

## Collection 规范

每个 Collection 至少定义：

- `slug`
- `admin.useAsTitle`
- `admin.group`
- `access`
- `fields`

推荐：

```ts
admin: {
  useAsTitle: 'title',
  group: '业务模块',
  defaultColumns: ['title', 'updatedAt'],
}
```

## Access 规范

默认保守：

```ts
access: {
  read: ({ req }) => Boolean(req.user),
  create: ({ req }) => Boolean(req.user),
  update: ({ req }) => Boolean(req.user),
  delete: ({ req }) => Boolean(req.user),
}
```

公共内容再显式开放：

```ts
read: () => true
```

## Jobs 规范

耗时任务必须进入 Jobs Queue：

- AI 生成
- 文件解析
- Embedding
- 外部同步
- 批量处理

Job 命名采用动词 + 业务对象：

```text
processNote
generateDocumentSummary
syncLarkContacts
embedKnowledgeChunk
```

## 插件接入 platform

1. 在 `apps/platform/package.json` 添加 workspace 依赖。
2. 在 `payload.config.ts` 中 import 插件。
3. 放进 `plugins` 数组。
4. 如需给 AI 使用，再在 `mcpPlugin` 中显式开启对应 Collection / Global / Tool。
