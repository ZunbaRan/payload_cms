# AI-Native 设计模式

本脚手架为后续 AI-Native 功能预留几个标准模式。这些模式来自当前 MVP 与 Finly 实验项目的共同经验。

## 1. Prompt 管理使用 Payload Global

不要把 Prompt 写死在代码中。推荐每个 AI 插件提供一个 Global：

```text
AiConfig
  modelId
  generateTags.prompt
  classifyImportance.prompt
  summarizeDocument.prompt
```

收益：

- Admin UI 可修改 Prompt
- 不需要重新部署
- 可按场景切换模型
- 可记录配置变更

## 2. AI 调用封装在 shared

AI SDK 选择可能变化：

- 原生 `@anthropic-ai/sdk`
- Vercel AI SDK
- OpenAI SDK
- 自建 gateway

业务插件不直接依赖具体厂商 SDK，而是依赖 shared wrapper：

```text
@project/shared/ai
```

这样以后从 Anthropic SDK 切到 Vercel AI SDK，不影响插件层。

## 3. 结构化输出优先使用 Schema

不要长期依赖“让 AI 返回 JSON 字符串再手动 parse”。

推荐优先级：

1. Vercel AI SDK `generateObject` + Zod
2. OpenAI / Anthropic 原生 structured output / tool use
3. 最后才是 prompt 约束 + JSON.parse

## 4. 耗时 AI 任务进入 Jobs Queue

以下任务必须走 Jobs Queue：

- 文档解析
- 摘要生成
- 标签生成
- 批量分类
- Embedding
- 外部系统同步

原因：

- 可重试
- 可恢复
- 不阻塞用户请求
- 可以在 Vercel Cron 或自托管 autoRun 中运行

## 5. TokenUsage Collection

生产级 AI 系统必须记录：

- modelId
- scene
- inputTokens
- outputTokens
- totalTokens
- messages
- tool calls
- owner / related document
- error

用途：

- 成本分析
- Prompt 调试
- 质量回放
- 审计
- 模型切换评估

## 6. RAG 存储策略

两种路线：

### 轻量实验

使用 Chroma：

```text
Payload SQLite + Chroma
```

适合 demo、学习、快速验证。

### 生产集成

使用 Postgres + pgvector：

```text
Payload Postgres + pgvector + HNSW index
```

适合统一备份、统一权限、统一查询、hybrid search。

## 7. MCP 与 AI-Native 的结合

MCP 暴露的是“系统能力”，不是裸数据库。

对于 AI-Native 应用，建议暴露：

- 只读知识查询
- 创建草稿
- 更新任务状态
- 读取 / 更新 AI Prompt 配置
- 触发安全的 Job

不建议直接暴露：

- 删除能力
- 用户管理
- 密钥管理
- 大范围批量更新

## 8. 推荐插件拆分

```text
plugin-ai
  AiConfig Global
  TokenUsage Collection
  AI Jobs

plugin-notes
  Notes Collection
  note processing hooks

plugin-documents
  Documents Collection
  file parsing jobs
  chunking jobs

plugin-search
  Search Index Collection
  embedding jobs
  semantic search API

plugin-tasks
  Task Collection
  AI task creation tools
```
