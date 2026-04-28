# GEOFlow → Payload CMS 迁移计划

## 一、源项目（GEOFlow-main）概览

**GEOFlow** 是一个开源的 **Generative Engine Optimization (GEO)** 系统 —— 基于 Laravel 12 / PHP 8.2 / PostgreSQL (pgvector) / Redis / Laravel Reverb 构建的 AI 内容工程平台。核心能力：

1. **任务调度与编排**：定时/触发式任务，控制内容生产节奏
2. **AI 内容生成引擎**：多模型容灾、Prompt 模板、Markdown Writer Agent
3. **文章生命周期**：草稿 → 审核 → 发布，软删除、批量操作、SEO 元数据
4. **素材库**（5 个）：标题库、关键词库、图片库、作者、知识库（RAG + pgvector）
5. **内容分类**：层级化 Category
6. **用户权限**：多管理员、活动审计、API Token (Sanctum)
7. **REST API v1**：Sanctum + scope + idempotency key
8. **站点设置**：品牌、主题、上传限制、安全策略
9. **可观测性**：Worker 心跳、Reverb 实时广播、Horizon 指标
10. **URL 导入**：批量抓取 URL 入库
11. **内容审核**：敏感词、活动日志、系统日志

**统计**：27 个 Eloquent 模型 / 22 个 Admin Controller / 13 个核心 Service / 5 个 API Controller。

---

## 二、迁移到 Payload 的插件划分（8 个插件）

| 插件 | Slug | 数据模型 | 对应 GEOFlow 模块 |
|------|------|---------|------------------|
| `@scaffold/plugin-materials` | `authors` `title-libraries` `titles` `keyword-libraries` `keywords` `image-libraries` `images` | Author / Title* / Keyword* / Image* | Domain 4 素材管理 |
| `@scaffold/plugin-knowledge-base` | `knowledge-bases` `knowledge-chunks` | KnowledgeBase / KnowledgeChunk | Domain 4e RAG |
| `@scaffold/plugin-ai-engine` | `ai-models` `prompts` | AiModel / Prompt | Domain 2 AI 引擎 |
| `@scaffold/plugin-content` | `categories` `articles` `article-reviews` | Category / Article / ArticleReview | Domain 3 + Domain 5 |
| `@scaffold/plugin-tasks` | `tasks` `task-runs` `task-schedules` `worker-heartbeats` | Task / TaskRun / TaskSchedule / WorkerHeartbeat | Domain 1 + Domain 9（部分）|
| `@scaffold/plugin-moderation` | `sensitive-words` `activity-logs` `system-logs` | SensitiveWord / AdminActivityLog / SystemLog | Domain 11 + Domain 6（审计部分） |
| `@scaffold/plugin-url-import` | `url-import-jobs` `url-import-job-logs` | UrlImportJob / UrlImportJobLog | Domain 10 |
| `@scaffold/plugin-site-settings` | `site-settings` (Global) | SiteSetting | Domain 8 |

### 不迁移 / 由 Payload 原生提供的能力

| GEOFlow 功能 | Payload 替代 |
|--------------|-------------|
| `Admin` / 多管理员 / 登录 | `users` collection（已内置 auth） |
| API Token / Sanctum | Payload REST + GraphQL + 内置 auth；如需 PAT 可后续加插件 |
| `ApiIdempotencyKey` | 推荐由网关或自定义 endpoint 处理 |
| Laravel Queue / Horizon | Payload Jobs Queue（独立插件，后续接入） |
| Laravel Reverb (WebSocket) | 暂缓；如需实时再接 Pusher/SSE |
| Blade / Tailwind 前台 | Next.js App Router（platform 应用）|

---

## 三、加载顺序与依赖

依赖关系图（关系字段反向链）：

```
materials (authors, title-libraries, titles, keyword-libraries, keywords, image-libraries, images)
    │
    ├── 被 knowledge-base 用作上传图（无强依赖）
    │
    ├── 被 ai-engine 引用（无）
    │
    ├── 被 content 引用：authors, categories（自身）, keywords, images
    │
    └── 被 tasks 引用：authors, title-libraries, keyword-libraries, image-libraries, categories
```

`payload.config.ts` 中已按顺序注册：

```ts
plugins: [
  materialsPlugin(),
  knowledgeBasePlugin(),
  aiEnginePlugin(),
  contentPlugin(),
  tasksPlugin(),
  moderationPlugin(),
  urlImportPlugin(),
  siteSettingsPlugin(),
  mcpPlugin({ /* 选择性暴露给 AI Agent */ }),
]
```

---

## 四、关键设计决策（与 SKILL.md 对照）

### 1. Select vs Relationship

| 字段 | 选择 | 理由 |
|------|------|------|
| `articles.category` | **relationship** → categories | 用户可增改分类 |
| `articles.author` | **relationship** → authors | 多作者可扩展 |
| `articles.keywords` | **relationship hasMany** → keywords | 复用关键词库 |
| `tasks.aiModel` / `tasks.prompt` | **relationship** | 模型/Prompt 会扩展 |
| `articles.status` | **select** (固定枚举) | draft/pending-review/published/archived 是工作流状态 |
| `tasks.status` | **select** | 任务生命周期状态 |
| `ai-models.provider` | **select** | 由代码逻辑决定（每个 provider 有 SDK 适配） |
| `sensitive-words.severity/action` | **select** | 业务规则枚举 |

### 2. 富文本

`articles.content` 使用 **Lexical 编辑器**（Payload 默认）。GEOFlow 原始数据是 Markdown / HTML，导入时需用 `@payloadcms/richtext-lexical/migrate` 工具或自定义转换器（`html-to-lexical`）。

### 3. 上传

- `images` 是 **Upload Collection**，启用 `staticDir: 'media/images'` + `mimeTypes: image/*`。
- `articles.coverImage` / `inlineImages` 通过 upload 关系字段引用。

### 4. 版本与草稿

`articles` 启用 `versions: { drafts: true }`，匹配 GEOFlow 的 draft → publish 流程。

### 5. 不变量字段

`viewCount` / `chunkCount` / `usageCount` / `totalRuns` 等聚合字段标记 `admin.readOnly: true`，由 Hook 维护。

---

## 五、数据导入路线（Phase 5 SKILL）

> 当前阶段只完成 Schema。真正导入 GEOFlow 历史数据需按下面顺序，分批跑导入脚本（建议放在 `apps/platform/scripts/migrate-from-geoflow.ts`，使用 Payload Local API）。

| 顺序 | Collection | 来源 PG 表 | 备注 |
|------|-----------|-----------|------|
| 1 | `users` | `admins` | 邮箱+密码字段映射；密码哈希算法不同（bcrypt vs Payload argon2），需提示用户首次登录重置 |
| 2 | `authors` | `authors` | 直接映射 |
| 3 | `categories` | `categories` | 父子关系：先平铺，再回写 `parent` |
| 4 | `image-libraries` / `images` | `image_libraries` / `images` | 文件需要从 GEOFlow `/storage/app/public` 下载并重新上传到 Payload |
| 5 | `title-libraries` / `titles` | 同名表 | 直接映射 |
| 6 | `keyword-libraries` / `keywords` | 同名表 | 直接映射 |
| 7 | `ai-models` | `ai_models` | API Key 字段直接迁移（建议加密） |
| 8 | `prompts` | `prompts` | system + user 模板字段拆开 |
| 9 | `knowledge-bases` / `knowledge-chunks` | 同名表 | embedding 列 → JSON 字段；正式部署接 pgvector |
| 10 | `tasks` / `task-schedules` | 同名表 | 解析关联外键到上面已迁移的 ID |
| 11 | `task-runs` | `task_runs` | 历史运行记录可选导入 |
| 12 | `articles` / `article-reviews` | 同名表 | **Markdown/HTML → Lexical 转换** 是关键步骤 |
| 13 | `sensitive-words` | `sensitive_words` | 直接映射 |
| 14 | `activity-logs` / `system-logs` | `admin_activity_logs` / `system_logs` | 历史日志可选 |
| 15 | `url-import-jobs` / `url-import-job-logs` | 同名表 | 历史任务可选 |
| 16 | `site-settings` (Global) | `site_settings` 行→Global 字段 | 一次性写入 |

### 关键转换器

需要在 `packages/shared` 实现：

- `htmlToLexical(html: string)` — 文章正文转换
- `pgvectorToJson(buffer)` — embedding 字段转换
- `bcryptHashHandoff(user)` — 用户密码迁移策略

---

## 六、后续 Roadmap

当前 Phase 完成的是 **Schema-first 迁移**（Collections + Globals）。下一步应当：

1. **Hooks**: 给 `articles.beforeChange` 加敏感词扫描；`task-runs.afterCreate` 触发 Job
2. **Jobs Queue**: 引入 `@payloadcms/plugin-jobs-queue` 替代 Laravel Queue
   - `processTaskRun` — 执行任务（取标题→生成→插图→建文章）
   - `embedKnowledgeChunk` — 切分并写 embedding
   - `importUrlBatch` — URL 批量导入
3. **Custom Endpoints**：
   - `POST /api/tasks/:id/start|stop|enqueue`
   - `POST /api/articles/:id/review|publish`
4. **Shared SDK**（在 `packages/shared`）：
   - `aiClient(model: AiModel)` — OpenAI-compatible 抽象
   - `embedder(model: AiModel, text: string)` — Embedding 适配
   - `vectorStore` — pgvector / 内存 fallback
5. **Admin UI 增强**：
   - 任务监控面板（自定义 React view）
   - Reverb 替代方案（SSE / Pusher）
6. **MCP 工具扩展**：暴露 `runTask` / `searchKnowledgeBase` 给 AI Agent

---

## 七、当前交付内容

- ✅ 8 个插件包已 scaffold 完成
- ✅ 24 个 Collection + 1 个 Global
- ✅ `apps/platform/src/payload.config.ts` 已注册全部插件
- ✅ MCP 已选择性开启 articles / tasks / prompts 等核心 Collection
- ✅ `pnpm install` 通过 / `payload generate:types` 通过

直接 `cd apps/platform && pnpm dev` 即可启动 admin 后台预览所有 Collection。
