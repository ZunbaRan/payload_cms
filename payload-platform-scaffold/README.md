# Payload Platform Scaffold

这是一个可复用的 Payload CMS 基础脚手架，用来固化当前已经验证过的总体架构：

```text
platform app + plugin packages + official MCP plugin
```

以后新的 Payload CMS 功能开发，优先从这个脚手架复制，然后按业务领域新增插件包。

## 目录结构

```text
payload-platform-scaffold/
├── apps/
│   └── platform/              # 唯一运行时应用：Next.js + Payload
├── packages/
│   ├── shared/                # 跨插件共享工具、类型、SDK wrapper
│   └── plugin-example/        # 业务插件模板
├── docs/                      # 架构、插件开发、MCP、AI-Native 设计文档
├── package.json
└── pnpm-workspace.yaml
```

## 核心原则

1. `apps/platform` 只负责组装系统，不堆业务逻辑。
2. 每个业务能力进入独立 `packages/plugin-*`。
3. 跨插件复用代码放入 `packages/shared`。
4. MCP 只暴露明确需要给 AI Agent 使用的能力，不默认暴露全系统。
5. 所有 Prompt、模型、权限、可观测数据都优先用 Payload Collection / Global 管理。

## 启动

```bash
cd payload-platform-scaffold
pnpm install
cd apps/platform
cp .env.example .env
cd ../..
pnpm dev
```

初始化后访问：

- Admin: http://localhost:3000/admin
- MCP endpoint: http://localhost:3000/api/mcp

## 新增业务插件

复制 `packages/plugin-example` 为新包，例如：

```text
packages/plugin-notes
packages/plugin-tasks
packages/plugin-ai
packages/plugin-documents
```

然后在 [apps/platform/src/payload.config.ts](apps/platform/src/payload.config.ts) 中引入并注册：

```ts
plugins: [
  notesPlugin(),
  mcpPlugin({
    collections: {
      notes: { enabled: { find: true, create: true, update: true } },
    },
  }),
]
```

详见 [docs/02-plugin-development.md](docs/02-plugin-development.md)。
