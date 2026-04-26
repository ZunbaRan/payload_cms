# 架构设计：Platform + Plugin Packages + MCP

## 目标

这个脚手架的目标是把 Payload CMS 项目拆成三个稳定层次：

```text
apps/platform
  负责运行、配置、路由、数据库、MCP 接入

packages/plugin-*
  负责业务模块：Collections、Globals、Jobs、Hooks、Access Rules

packages/shared
  负责跨插件复用：AI SDK、外部 API、工具函数、共享类型
```

## 为什么这样设计

Payload 本身非常适合做内部业务系统和 AI-Native 应用，但如果所有 Collection、Job、Hook 都堆进一个应用目录，项目会快速变得难以维护。

插件化拆分带来几个好处：

1. **业务边界清晰**：Notes、Tasks、Documents、AI、Contract 都可以独立维护。
2. **平台层稳定**：`apps/platform` 只做组装，不承载复杂业务。
3. **可迁移**：某个插件可以复制到另一个 Payload 项目。
4. **可裁剪**：通过 `plugin({ enabled: false })` 关闭模块。
5. **适合 MCP**：每个插件天然对应一组可暴露给 AI Agent 的能力。

## 分层职责

### apps/platform

只放运行时必需内容：

- `payload.config.ts`
- Next.js App Router 路由
- Admin / REST / Jobs route handler
- 根级用户集合 `Users`
- 官方插件配置，如 `@payloadcms/plugin-mcp`
- 数据库 adapter 配置

不建议放：

- 业务 Collection
- 业务 Job
- 外部 API 调用封装
- AI prompt 逻辑

### packages/plugin-*

每个插件代表一个业务能力域。

典型内容：

```text
packages/plugin-notes/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── collections/
    ├── globals/
    ├── jobs/
    ├── hooks/
    └── access/
```

插件入口统一导出：

```ts
export const notesPlugin =
  (options = {}): Plugin =>
  (incomingConfig) => ({
    ...incomingConfig,
    collections: [...(incomingConfig.collections || []), Notes],
  })
```

### packages/shared

只放真正跨插件使用的代码：

- AI SDK wrapper
- Chroma / pgvector helper
- Feishu / Lark / Stripe 等外部 API wrapper
- 通用权限函数
- 通用模板渲染
- 通用类型

不要把业务状态或业务 Collection 放入 shared。

## 标准数据流

```text
User / Admin UI
  ↓
Payload Collection / Global
  ↓
Hook / Job / Local API
  ↓
Shared SDK wrapper / external service
  ↓
Payload update / TokenUsage / AuditLog
```

## AI Agent 数据流

```text
AI Client
  ↓ MCP protocol
/api/mcp
  ↓ @payloadcms/plugin-mcp
Payload Local API
  ↓ access control + hooks
Collections / Globals / Jobs
```

MCP 不应该绕开 Payload 的访问控制。所有 MCP 工具最终仍走 Payload 的权限规则和 hooks。

## 设计边界

### 放到插件的情况

- 这是一个业务概念，比如 Notes、Tasks、Documents
- 需要自己的 Collection 或 Global
- 有自己的 Job / Hook / Access Rule
- 未来可能独立迁移或关闭

### 放到 shared 的情况

- 多个插件都会调用
- 不依赖某个业务 Collection
- 是工具、SDK、类型、协议封装

### 放到 platform 的情况

- Payload 根配置
- 数据库配置
- 官方插件组合
- Next.js 路由入口
- 全局用户认证集合
