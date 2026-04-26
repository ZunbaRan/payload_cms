# Finly AI-Native 项目分析

> 原文：[Building AI-Native Applications with Payload CMS and the Vercel AI SDK](https://finly.ch/engineering-blog/916926-building-ai-native-applications-with-payload-cms-and-the-vercel-ai-sdk)
> 作者：Ravi（InnoPeak CTO）
> 发布时间：2025年12月

## 背景

Finly 是瑞士一家 FinSureTech 公司（面向金融顾问 / 保险经纪人），
他们用 **Payload  CMS + Vercel AI SDK** 构建了一套 AI-Native 的顾问支持平台。

核心观点：**生产级 AI 应用本质上是架构问题**。Demo 好写，但真正落地需要：
- Prompt 能在代码外管理
- 长时 AI 任务能可靠执行
- Embedding 能存储和检索
- 结构化输出能强制约束
- AI 行为能被完整观测

---

## 四个核心实践

### 1. Prompt & 模型管理（Admin 无代码配置）

**问题**：Prompt 硬编码在代码里，每次调整都要部署。

**方案**：用 **Payload Global** 存储 Prompt 和模型配置：

```ts
export const Ai: GlobalConfig = {
  slug: "ai",
  fields: [
    {
      name: "modelId",
      type: "select",
      options: ["mistral-large-latest", "mistral-medium-latest", ...],
      defaultValue: "mistral-medium-latest",
      required: true,
    },
    {
      name: "healthInsuranceRecommendations",
      type: "group",
      fields: [
        { name: "systemPrompt", type: "textarea", required: true },
        { name: "userPrompt",   type: "textarea", required: true },
      ],
    },
  ],
}
```

- Prompt 用 **Handlebars 模板**动态插值业务数据
- 非开发人员可在 Admin UI 修改 Prompt、切换模型，**无需重新部署**
- 还做了自定义 UI Field，在 Admin 里**可视化展示 Zod → JSON Schema**，
  方便直接复制到 LLM 测试环境验证结构化输出

---

### 2. 后台 AI Jobs（异步任务队列）

使用 **Payload Jobs Queue** 处理耗时 AI 任务，特性：
- 任务可编排为多步 workflow
- 内置自动重试
- Vercel 环境：用 CRON Job 触发
- Docker / 自托管：用 `autoRun` + cron 表达式

核心价值：**不需要自建队列基础设施**，专心写业务 workflow。

---

### 3. 在 Payload DB 存 Embeddings（RAG）

**问题**：Payload 原生不支持 vector 字段。

**方案**：通过 `beforeSchemaInit` / `afterSchemaInit` 钩子扩展 Drizzle Schema：

```ts
db: postgresAdapter({
  beforeSchemaInit: [
    ({ schema, adapter }) => {
      // 让 payload generate:db-schema 能感知到 embedding 列
      adapter.rawTables.additional_health_insurance_packages.columns.embedding = {
        name: "embedding",
        type: "vector",
        dimensions: 1024,
      }
      return schema
    },
  ],
  afterSchemaInit: [
    ({ schema, extendTable }) => {
      // 创建 HNSW 向量索引 + GIN 全文索引
      extendTable({
        table: schema.tables.additional_health_insurance_packages,
        extraConfig: (table) => ({
          cosine_index: index("cosine_index").using("hnsw", table.embedding.op("vector_cosine_ops")),
          l2_index:     index("l2_index").using("hnsw", table.embedding.op("vector_l2_ops")),
          ts_index:     index("ts_index").using("gin", sql`to_tsvector('english', ${table.embeddingText})`),
        }),
      })
      return schema
    },
  ],
})
```

查询时混合**向量相似度 + 全文检索**（hybrid search）：

```ts
// 1. Embed 查询字符串
const { embedding } = await embed({
  model: mistral.embedding("mistral-embed"),
  value: preferences,
})

// 2. 向量 + 全文混合检索
const results = await payload.db.drizzle
  .select({ id, similarity: cosineDistance(table.embedding, embedding), ts_rank })
  .from(table)
  .orderBy(desc(score))
  .limit(100)
```

> ⚠️ 注意：从 `@payloadcms/db-postgres/drizzle` 导入 `cosineDistance`，
> 不要用 `drizzle-orm`，避免版本冲突。

---

### 4. Token 用量 & 消息追踪（可观测性）

创建 `TokenUsage` Collection，记录每次 AI 调用：

```ts
export const TokenUsage: CollectionConfig = {
  slug: "token-usages",
  fields: [
    { name: "type", type: "select", options: ["completions", "embedding"] },
    { name: "modelId", type: "select", ... },
    {
      name: "usage",
      type: "group",
      fields: [inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens],
    },
    {
      name: "owner",
      type: "relationship",
      relationTo: ["chats", "comparisons", "recommendations", ...],
    },
    {
      name: "messages",  // 完整的 messages 数组，含 tool calls
      type: "array",
      fields: messageFields,
    },
  ],
}
```

通过 Vercel AI SDK 的 `onFinish` 回调自动写入：

```ts
const result = streamText({
  model: mistral(ai.chat.modelId),
  messages: convertToModelMessages(validatedMessages),
  onFinish: trackUsage(user, payload, ai.chat.modelId, { relationTo: "chats", value: chat }),
})
```

在 Admin 里可以**直接审查生产环境中真实的 Prompt、AI 响应、Tool Calls**，
非常适合调试和迭代优化。

---

## 与 MVP Platform 的对比

| 能力 | MVP Platform（当前） | Finly 方案 |
|------|---------------------|-----------|
| Prompt 管理 | 硬编码在 `shared/ai.ts` | ✅ Payload Global，Admin 可配置 |
| 模型切换 | 硬编码 | ✅ Admin select 字段 |
| 向量 / RAG | ❌ 未实现 | ✅ pgvector + HNSW 索引 |
| Token 追踪 | ❌ 未实现 | ✅ TokenUsage Collection |
| 消息追踪 | ❌ 未实现 | ✅ messages 数组完整存储 |
| AI Jobs | ✅ Jobs Queue | ✅ 相同模式 |
| 结构化输出 | ✅ Zod schema | ✅ Vercel AI SDK JSON schema |

---

## 复刻计划

参见 [02-implementation-plan.md](./02-implementation-plan.md)
