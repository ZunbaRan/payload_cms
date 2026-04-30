# Payload REST API 参考

> 自动生成于 2026-04-29T13:44:48.543Z（基于运行时 `payload.config`），后经人工完善字段说明与注释。

Base URL: `http://localhost:3000/api`

---

## 系统架构概览

本平台是一个 **AI 驱动的内容生产系统**，基于 Payload CMS 3.x + Next.js 构建，核心功能模块如下：

```
内容生产流水线
├── 素材层
│   ├── keywords / keyword-libraries   关键词池
│   ├── titles / title-libraries       标题库
│   └── images / image-libraries       图片库
├── 知识库层（RAG）
│   ├── knowledge-bases                知识库配置
│   ├── knowledge-chunks               切块向量化存储
│   ├── kb-uploads                     手动上传的源文件
│   └── kb-index-runs                  索引任务运行记录
├── AI 引擎层
│   ├── ai-models                      模型配置（text / embedding）
│   ├── prompts                        Prompt 模板
│   ├── agent-skills                   可上传的 Agent 技能包
│   ├── agent-tasks                    Agent 任务定义
│   └── agent-task-runs               Agent 任务执行日志
├── 内容层
│   ├── articles                       文章（草稿/发布/版本控制）
│   ├── article-reviews               审稿记录
│   ├── authors / categories / tags    作者/分类/标签
│   └── tasks / task-runs / task-schedules  内容生产任务调度
├── 辅助层
│   ├── sensitive-words                内容审核词库
│   ├── url-import-jobs / logs         批量 URL 导入
│   ├── activity-logs / system-logs    审计 & 系统日志
│   └── payload-mcp-api-keys          MCP 客户端 API Key
└── 基础设施（Payload 内置）
    ├── payload-jobs                   后台任务队列
    ├── payload-kv                     键值存储
    ├── payload-locked-documents       文档锁
    ├── payload-preferences            用户 UI 偏好
    └── payload-migrations             数据库迁移记录
```

**已注册的后台任务类型（`payload-jobs` 的 `taskSlug`）：**

| taskSlug | 触发方式 | 说明 |
|----------|----------|------|
| `indexKnowledgeBase` | `POST /api/knowledge-bases/:id/reindex` | 完整索引：抓取 → 切块 → 向量化 |
| `embedKnowledgeChunk` | indexKnowledgeBase 子任务 | 对单个 chunk 生成 embedding |
| `processAgentTaskRun` | `POST /api/agent-tasks/:id/run` | 运行一次 agent-task |
| `processTaskRun` | `POST /api/tasks/:id/run` | 运行一次内容生产 task |
| `importUrlBatch` | URL 导入任务触发 | 批量抓取 URL 并写入 KB / 文章 |
| `inline` | 代码内联触发 | 内部轻量异步任务 |

---

## 🔑 测试账号 & 即用 Token

> ⚠️ **仅供本地测试项目使用**，请勿在生产环境暴露。

| 字段 | 值 |
|------|---|
| Email | `admin@test.com` |
| Password | `Admin@test123` |
| 角色 | 超级管理员（users collection 唯一账号） |

**即用 Bearer Token（有效期 7 天，2026-05-06 到期）**

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiY29sbGVjdGlvbiI6InVzZXJzIiwiZW1haWwiOiJhZG1pbkB0ZXN0LmNvbSIsInNpZCI6ImRmNTk2ZGRkLTA0OTctNDY2ZC1hZDljLTY4NTEzZjA4ODBlZSIsImlhdCI6MTc3NzQ3MDcwMSwiZXhwIjoxNzc4MDc1NTAxfQ.wn17oCiG5fdhJwjG3PZoLllZ0-zqzNTogsUsvDYJ5p0
```

**快速使用：**

```bash
TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiY29sbGVjdGlvbiI6InVzZXJzIiwiZW1haWwiOiJhZG1pbkB0ZXN0LmNvbSIsInNpZCI6ImRmNTk2ZGRkLTA0OTctNDY2ZC1hZDljLTY4NTEzZjA4ODBlZSIsImlhdCI6MTc3NzQ3MDcwMSwiZXhwIjoxNzc4MDc1NTAxfQ.wn17oCiG5fdhJwjG3PZoLllZ0-zqzNTogsUsvDYJ5p0'

# 验证 token 有效
curl -s 'http://localhost:3000/api/users/me' -H "Authorization: JWT $TOKEN" | python3 -m json.tool | head -10
```

**Token 失效后续期：**

```bash
# 重新登录拿新 token
curl -X POST 'http://localhost:3000/api/users/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"Admin@test123"}'
# 响应中的 token 字段即为新 JWT

# 在 token 过期前刷新（无需密码）
curl -X POST 'http://localhost:3000/api/users/refresh-token' \
  -H "Authorization: JWT $TOKEN"
```

---

## 鉴权

Payload 支持 3 种凭证（优先级依次）：

| 方式 | 格式 | 说明 |
|------|------|------|
| JWT Header | `Authorization: JWT <token>` | 最常用，登录后获取 |
| Bearer Header | `Authorization: Bearer <apiKey>` | API Key 方式（需启用 enableAPIKey） |
| Cookie | `payload-token=<token>` | Admin 面板登录后自动写入 |

---

## 通用查询参数

适用于所有 collection 的 `GET /api/<slug>` 列表端点：

| 参数 | 类型 | 说明 |
|------|------|------|
| `where` | object | 过滤条件。操作符：`equals`, `not_equals`, `in`, `not_in`, `like`, `contains`, `greater_than`, `less_than`, `exists`, `and`, `or`。示例：`?where[status][equals]=published` |
| `sort` | string | 排序字段，`-` 前缀表示倒序。示例：`?sort=-createdAt` 或 `?sort=name,-createdAt` |
| `limit` | number | 单页条数，`0` 返回全部（不推荐大数据集使用） |
| `page` | number | 页码（从 1 起） |
| `depth` | number | 关系字段展开深度，默认 2，最大 10。`0` 表示仅返回 id |
| `select` | object | 仅返回指定字段。示例：`?select[title]=true&select[slug]=true` |
| `populate` | object | 在关系展开中进一步精细选择字段 |
| `locale` | string | 本地化区域码（启用 localization 时生效） |
| `draft` | boolean | 拉取草稿版本（需启用 versions/drafts） |
| `trash` | boolean | 返回回收站中的记录（需启用 trash） |

**查询示例：**

```bash
# 查询已发布文章，按更新时间倒序，第 1 页，每页 10 条，只展开作者信息
curl -s 'http://localhost:3000/api/articles?where[status][equals]=published&sort=-updatedAt&limit=10&page=1&depth=1' \
  -H "Authorization: JWT $TOKEN"

# 模糊搜索标题含 "AI" 的文章
curl -s 'http://localhost:3000/api/articles?where[title][contains]=AI' \
  -H "Authorization: JWT $TOKEN"

# 多条件 AND 查询（已发布 + 精选）
curl -s 'http://localhost:3000/api/articles?where[and][0][status][equals]=published&where[and][1][isFeatured][equals]=true' \
  -H "Authorization: JWT $TOKEN"
```

---

## 标准端点（每个 collection 均有）

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/api/<slug>` | 列表查询（支持 where/sort/limit/page 等参数） |
| POST   | `/api/<slug>` | 创建文档 |
| GET    | `/api/<slug>/:id` | 获取单条文档 |
| PATCH  | `/api/<slug>/:id` | 更新文档（部分更新，未传字段不变） |
| DELETE | `/api/<slug>/:id` | 删除文档 |
| POST   | `/api/<slug>/:id/duplicate` | 复制文档（生成同内容新记录） |
| GET    | `/api/<slug>/count` | 返回符合条件的文档数量 |
| GET    | `/api/<slug>/versions` | 版本列表（启用 versions 时） |
| GET    | `/api/<slug>/versions/:id` | 单个历史版本 |
| POST   | `/api/<slug>/versions/:id` | 恢复到指定历史版本 |

## Auth 端点（启用 `auth: true` 的 collection）

| Method | Path | 用途 |
|--------|------|------|
| POST   | `/api/<slug>/login` | 登录，返回 token |
| POST   | `/api/<slug>/logout` | 登出（清除 cookie） |
| GET    | `/api/<slug>/me` | 返回当前已认证用户信息 |
| POST   | `/api/<slug>/refresh-token` | 刷新 JWT token |
| POST   | `/api/<slug>/forgot-password` | 发起密码重置邮件 |
| POST   | `/api/<slug>/reset-password` | 使用重置 token 设置新密码 |
| POST   | `/api/<slug>/unlock` | 解锁因多次登录失败被锁的账号 |

---

# Collections 目录

| Collection | 功能 |
|-----------|------|
| [`users`](#users) | 管理员账号，含 JWT 鉴权 |
| [`authors`](#authors) | 文章署名作者档案 |
| [`tags`](#tags) | 内容标签分类 |
| [`title-libraries`](#title-libraries) | 标题库容器 |
| [`titles`](#titles) | 可复用标题条目 |
| [`keyword-libraries`](#keyword-libraries) | 关键词库容器 |
| [`keywords`](#keywords) | 关键词条目（含权重/标签） |
| [`image-libraries`](#image-libraries) | 图片库容器 |
| [`images`](#images) | 上传图片（upload collection） |
| [`knowledge-bases`](#knowledge-bases) | RAG 知识库配置 |
| [`knowledge-chunks`](#knowledge-chunks) | 切块后的向量化内容片段 |
| [`kb-uploads`](#kb-uploads) | 知识库手动上传的源文件 |
| [`kb-index-runs`](#kb-index-runs) | 知识库索引任务运行记录 |
| [`ai-models`](#ai-models) | AI 模型连接配置 |
| [`prompts`](#prompts) | Prompt 模板库 |
| [`categories`](#categories) | 文章分类（支持树形层级） |
| [`articles`](#articles) | 文章内容（支持草稿/发布/版本） |
| [`article-reviews`](#article-reviews) | 文章审稿记录 |
| [`tasks`](#tasks) | 内容生产任务配置 |
| [`task-runs`](#task-runs) | 内容任务执行日志 |
| [`task-schedules`](#task-schedules) | 定时任务 Cron 配置 |
| [`worker-heartbeats`](#worker-heartbeats) | 后台 worker 心跳监控 |
| [`agent-skills`](#agent-skills) | Agent 技能包（zip/SKILL.md） |
| [`agent-tasks`](#agent-tasks) | Agent 任务定义 |
| [`agent-task-runs`](#agent-task-runs) | Agent 任务执行日志 |
| [`sensitive-words`](#sensitive-words) | 内容审核敏感词库 |
| [`activity-logs`](#activity-logs) | 用户操作审计日志 |
| [`system-logs`](#system-logs) | 应用系统日志 |
| [`url-import-jobs`](#url-import-jobs) | 批量 URL 导入任务 |
| [`url-import-job-logs`](#url-import-job-logs) | 每条 URL 的导入结果 |
| [`payload-mcp-api-keys`](#payload-mcp-api-keys) | MCP 客户端 API Key 管理 |
| [`payload-kv`](#payload-kv) | 键值对存储（内部缓存用） |
| [`payload-jobs`](#payload-jobs) | 后台任务队列（Payload 内置） |
| [`payload-locked-documents`](#payload-locked-documents) | 文档编辑锁（Payload 内置） |
| [`payload-preferences`](#payload-preferences) | 用户 UI 偏好（Payload 内置） |
| [`payload-migrations`](#payload-migrations) | 数据库迁移记录（Payload 内置） |

---

## `users`

**功能**：系统管理员账号。是唯一拥有完整权限的用户类型，通过 JWT 完成鉴权。与 `payload-mcp-api-keys` 不同，users 是人工操作者账号，不是机器 API Key。

**特性**：auth（JWT 登录）

**端点基址**：`/api/users`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 自动生成的主键 |
| `email` | email | ✓ | 登录邮箱，全局唯一 |
| `sessions` | array | | 当前活跃 JWT 会话列表 |
| `sessions[].id` | text | ✓ | Session ID（UUID） |
| `sessions[].createdAt` | date | | Session 创建时间 |
| `sessions[].expiresAt` | date | ✓ | Session 过期时间（TTL=7天） |
| `resetPasswordToken` | text | | 密码重置 token（临时，用后清空） |
| `resetPasswordExpiration` | date | | 重置 token 过期时间 |
| `loginAttempts` | number | | 连续登录失败次数（超限自动锁定） |
| `lockUntil` | date | | 账号锁定截止时间 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

> `salt` / `hash` 字段存储密码哈希，API 响应中不返回。

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/users/login` | 登录，Body: `{email, password}`，响应包含 `token`、`exp`、`user` |
| GET | `/api/users/me` | 返回当前 JWT 对应的用户信息 |
| POST | `/api/users/refresh-token` | 刷新 JWT，无需密码，需 Header 携带有效 token |
| POST | `/api/users/logout` | 使当前 session 失效 |
| POST | `/api/users/forgot-password` | 发送密码重置邮件，Body: `{email}` |
| POST | `/api/users/reset-password` | 重置密码，Body: `{token, password}` |
| POST | `/api/users/unlock` | 解锁被锁定的账号，Body: `{email}` |
| GET | `/api/users/init` | 检查系统是否已完成初始化（有无管理员账号） |
| POST | `/api/users/first-register` | 初始化时创建第一个管理员账号 |

**示例：**

```bash
# 登录
curl -X POST 'http://localhost:3000/api/users/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"Admin@test123"}'
```

---

## `authors`

**功能**：文章作者档案库。每篇文章可关联一个 author，用于署名展示。支持多作者轮换模式（由 tasks 配置控制）。

**端点基址**：`/api/authors`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 作者显示名称 |
| `slug` | text | | URL 友好标识符，全局唯一 |
| `email` | email | | 作者联系邮箱（可选，不用于登录） |
| `avatar` | upload | | 作者头像，关联 `images` collection |
| `bio` | textarea | | 作者简介文本 |
| `isActive` | checkbox | | 是否启用。`false` 时不会被 tasks 的轮换模式选中 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建作者
curl -X POST 'http://localhost:3000/api/authors' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"name":"张三","slug":"zhangsan","bio":"科技内容作者","isActive":true}'

# 查询所有活跃作者
curl -s 'http://localhost:3000/api/authors?where[isActive][equals]=true' \
  -H "Authorization: JWT $TOKEN"
```

---

## `tags`

**功能**：内容标签，用于对文章、关键词、图片进行多维度分类。`usageCount` 字段由系统自动维护，记录被引用次数。

**端点基址**：`/api/tags`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 标签显示名称 |
| `slug` | text | | URL 友好标识符，全局唯一。推荐与 `name` 对应 |
| `usageCount` | number | | 被引用次数，系统自动更新，无需手动维护 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建标签
curl -X POST 'http://localhost:3000/api/tags' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"name":"人工智能","slug":"ai"}'

# 查询使用次数最多的标签
curl -s 'http://localhost:3000/api/tags?sort=-usageCount&limit=10' \
  -H "Authorization: JWT $TOKEN"
```

---

## `title-libraries`

**功能**：标题库的容器/分组。一个 title-library 对应一个主题方向的标题集合（如"科技类标题"、"健康类标题"），通过 `titleCount` 追踪库内标题数量。tasks 可引用 title-library 来为文章选取标题。

**端点基址**：`/api/title-libraries`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 标题库名称 |
| `description` | textarea | | 库的用途描述 |
| `titleCount` | number | | 库内标题数量，由系统自动统计 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `titles`

**功能**：单条标题记录。标题是 AI 生成内容的起点，一篇文章对应一条使用中的 title。`status` 跟踪标题的生命周期，AI 生成的标题通过 `isAiGenerated` 标记。

**端点基址**：`/api/titles`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `text` | text | ✓ | 标题文本内容 |
| `library` | relationship | ✓ | 所属标题库 → `title-libraries` |
| `status` | select | | 标题使用状态：`pending`（待用）/ `used`（已用于文章）/ `archived`（归档弃用） |
| `isAiGenerated` | checkbox | | 是否由 AI 生成（区分人工录入 vs AI 产出） |
| `sourceKeywords` | text | | 生成该标题时使用的关键词记录（逗号分隔） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 查询待使用的标题（status=pending）
curl -s 'http://localhost:3000/api/titles?where[status][equals]=pending&limit=20' \
  -H "Authorization: JWT $TOKEN"

# 标记标题为已使用
curl -X PATCH 'http://localhost:3000/api/titles/5' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"status":"used"}'
```

---

## `keyword-libraries`

**功能**：关键词库的容器/分组，类似 title-libraries 的角色。一个 keyword-library 代表一个关键词主题池，供 tasks 消费。

**端点基址**：`/api/keyword-libraries`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 库名称 |
| `description` | textarea | | 库的用途描述 |
| `keywordCount` | number | | 库内关键词数量，系统自动维护 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `keywords`

**功能**：单条关键词记录。关键词是 AI 写作的上下文输入，通过 `weight` 控制被抽样的优先级，通过 `tags` 实现多维分类。

**端点基址**：`/api/keywords`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `text` | text | ✓ | 关键词文本 |
| `library` | relationship | ✓ | 所属关键词库 → `keyword-libraries` |
| `weight` | number | | 权重，影响随机抽样概率，数值越高越易被选中 |
| `tags` | relationship | | 所属标签（多个）→ `tags`（hasMany） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `image-libraries`

**功能**：图片库的容器/分组。tasks 可指定 image-library 为文章选配封面图或插图。

**端点基址**：`/api/image-libraries`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 库名称 |
| `description` | textarea | | 库的描述 |
| `imageCount` | number | | 库内图片数量，系统自动维护 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `images`

**功能**：图片上传与管理。是 Payload upload collection，实际文件存储在服务器，访问通过 `/api/images/file/:filename` 或 `url` 字段。支持 `usageCount` 跟踪使用次数，通过 `tags` 和 `library` 组织归类。

**特性**：upload（multipart/form-data 上传）

**端点基址**：`/api/images`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `alt` | text | | 图片 alt 文本，用于无障碍和 SEO |
| `library` | relationship | | 所属图片库 → `image-libraries` |
| `caption` | text | | 图片说明文字（展示用） |
| `usageCount` | number | | 被文章引用的次数 |
| `tags` | relationship | | 标签（多个）→ `tags`（hasMany） |
| `url` | text | | 图片访问 URL（Payload 自动填充） |
| `thumbnailURL` | text | | 缩略图 URL（若配置了 imageSizes） |
| `filename` | text | | 文件名，全局唯一 |
| `mimeType` | text | | MIME 类型，如 `image/jpeg` |
| `filesize` | number | | 文件大小（字节） |
| `width` | number | | 图片宽度（px） |
| `height` | number | | 图片高度（px） |
| `focalX` | number | | 焦点横坐标（0-100），用于智能裁剪 |
| `focalY` | number | | 焦点纵坐标（0-100），用于智能裁剪 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/images` | 上传图片文件，Content-Type: multipart/form-data，字段名 `file` |
| GET | `/api/images/file/:filename` | 直接访问原始图片文件（无需鉴权） |
| GET | `/api/images/paste-url/:id?` | 通过外部 URL 导入图片（下载并存储到本地） |

**示例：**

```bash
# 上传图片
curl -X POST 'http://localhost:3000/api/images' \
  -H "Authorization: JWT $TOKEN" \
  -F "file=@/path/to/image.jpg" \
  -F 'alt=封面图片' \
  -F 'caption=文章配图'

# 访问图片（直接 URL，无需鉴权）
curl 'http://localhost:3000/api/images/file/my-image.jpg'
```

---

## `knowledge-bases`

**功能**：RAG（检索增强生成）知识库配置。每个 knowledge-base 定义一个知识来源：可以是手动输入的文本（`manual`）、上传的文件（`file`）、或通过 URL 抓取（`url`）。索引完成后内容以向量形式存于 `knowledge-chunks`，供 AI 任务检索使用。

**端点基址**：`/api/knowledge-bases`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 知识库名称 |
| `description` | textarea | | 知识库用途描述 |
| `sourceType` | select | | 内容来源类型：`manual`（直接输入 rawContent）/ `file`（关联 kb-uploads 文件）/ `url`（通过 agent-task 抓取） |
| `uploadedFile` | relationship | | sourceType=file 时关联的上传文件 → `kb-uploads` |
| `sourceUrl` | text | | sourceType=url 时的目标 URL |
| `rawContent` | textarea | | 知识库原始文本内容。`manual` 时直接填写；`file`/`url` 时由索引任务自动写入 |
| `chunkSize` | number | | 每个切块的 token 上限（默认 512） |
| `chunkOverlap` | number | | 相邻切块的 token 重叠数（默认 50，保证语义连贯性） |
| `embeddingModel` | relationship | | 向量化使用的 embedding 模型 → `ai-models`（需 modelType=embedding） |
| `syncStatus` | select | | 同步状态：`pending`（待索引）/ `syncing`（索引中）/ `synced`（已完成）/ `failed`（失败） |
| `chunkCount` | number | | 当前已生成的切块数量 |
| `lastSyncedAt` | date | | 最近一次索引完成时间 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/knowledge-bases/:id/reindex` | **触发切块索引**。创建 `kb-index-runs` 记录并入队 `indexKnowledgeBase` 任务。无需 Body。响应：`{success, jobId, indexRunId}` |
| POST | `/api/knowledge-bases/search` | **语义搜索**。在向量空间中检索最相关切块。Body: `{query, knowledgeBaseId?, limit?}`，响应包含最相关的 chunks 列表 |

**完整流程：**

```
1. 创建 knowledge-base，设置 sourceType 和 rawContent（或 uploadedFile/sourceUrl）
2. 配置 embeddingModel（指向一个 modelType=embedding 的 ai-models 记录）
3. 触发索引：POST /api/knowledge-bases/:id/reindex
4. 轮询进度：GET /api/kb-index-runs?where[knowledgeBase][equals]=<id>&sort=-createdAt
5. 完成后 syncStatus → synced，knowledge-chunks 写入向量数据
6. 可通过 POST /api/knowledge-bases/search 验证检索效果
```

**示例：**

```bash
# 创建知识库（手动输入内容）
curl -X POST 'http://localhost:3000/api/knowledge-bases' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "name": "产品文档",
    "sourceType": "manual",
    "rawContent": "这是产品的使用说明...",
    "chunkSize": 512,
    "chunkOverlap": 50,
    "embeddingModel": 1
  }'

# 触发索引（对 id=1 的知识库）
curl -X POST 'http://localhost:3000/api/knowledge-bases/1/reindex' \
  -H "Authorization: JWT $TOKEN"
# 响应：{"success":true,"jobId":"abc123","indexRunId":5}

# 语义搜索
curl -X POST 'http://localhost:3000/api/knowledge-bases/search' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"query":"如何配置模型","knowledgeBaseId":1,"limit":5}'
```

---

## `knowledge-chunks`

**功能**：知识库切块后的每一条向量化文本片段。由 `indexKnowledgeBase` 任务自动生成，通常不需要手动操作。`embedding` 字段存储高维向量（用于相似度检索），`metadata` 存储额外上下文信息。

**端点基址**：`/api/knowledge-chunks`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `knowledgeBase` | relationship | ✓ | 所属知识库 → `knowledge-bases` |
| `chunkIndex` | number | ✓ | 在知识库中的顺序索引（从 0 开始） |
| `content` | textarea | ✓ | 该切块的完整文本内容 |
| `preview` | text | | 内容预览（前 100 字符），方便在列表中快速识别 |
| `tokenCount` | number | | 该切块的 token 数量 |
| `embedding` | json | | 向量数组（float[]），由 embedding 模型生成，用于语义检索 |
| `metadata` | json | | 附加元数据，如来源页码、章节等 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 查看某知识库的所有切块
curl -s 'http://localhost:3000/api/knowledge-chunks?where[knowledgeBase][equals]=1&sort=chunkIndex&limit=20' \
  -H "Authorization: JWT $TOKEN"

# 统计切块数量
curl -s 'http://localhost:3000/api/knowledge-chunks/count?where[knowledgeBase][equals]=1' \
  -H "Authorization: JWT $TOKEN"
```

---

## `kb-uploads`

**功能**：知识库源文件上传桶。专门接收 `.txt / .md / .json / .csv` 等纯文本文件。上传后在 `knowledge-bases` 中将 `sourceType` 设为 `file` 并关联该记录，触发 reindex 后任务会读取文件内容写入 `rawContent`。

**特性**：upload（multipart/form-data，支持 text/plain、text/markdown、text/csv、application/json）

**文件存储路径**：`.geoflow-data/kb-uploads/`

**端点基址**：`/api/kb-uploads`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `note` | text | | 备注说明（如"第二季度产品手册"） |
| `url` | text | | 文件访问 URL（Payload 自动填充） |
| `filename` | text | | 文件名，全局唯一 |
| `mimeType` | text | | MIME 类型 |
| `filesize` | number | | 文件大小（字节） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/kb-uploads` | 上传源文件，Content-Type: multipart/form-data，字段名 `file` |
| GET | `/api/kb-uploads/file/:filename` | 直接访问已上传的文件内容 |

**示例：**

```bash
# 上传 Markdown 文档作为知识库源文件
curl -X POST 'http://localhost:3000/api/kb-uploads' \
  -H "Authorization: JWT $TOKEN" \
  -F "file=@/path/to/manual.md" \
  -F 'note=产品使用手册v2'
# 响应中获取 id，然后关联到 knowledge-bases

# 关联到知识库并触发索引
curl -X PATCH 'http://localhost:3000/api/knowledge-bases/1' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"sourceType":"file","uploadedFile":1}'

curl -X POST 'http://localhost:3000/api/knowledge-bases/1/reindex' \
  -H "Authorization: JWT $TOKEN"
```

---

## `kb-index-runs`

**功能**：每次触发知识库索引/抓取操作的运行记录，相当于执行日志。通过 `phase` + `progress` 实时追踪进度，`logs` 字段存储详细执行日志。索引完成后查看 `totalChunks` / `embeddedChunks` 确认结果。

**端点基址**：`/api/kb-index-runs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `knowledgeBase` | relationship | ✓ | 所属知识库 → `knowledge-bases` |
| `kind` | select | | 任务类型：`index`（切块+向量化）/ `fetch`（抓取 URL 内容） |
| `status` | select | | 运行状态：`queued`（已入队等待）/ `running`（执行中）/ `success`（成功）/ `failed`（失败） |
| `phase` | select | | 当前执行阶段：`pending` → `fetching`（抓取内容）→ `chunking`（切块）→ `embedding`（向量化）→ `done` |
| `progress` | number | | 进度百分比（0-100） |
| `totalChunks` | number | | 本次需处理的总切块数 |
| `embeddedChunks` | number | | 已完成向量化的切块数 |
| `startedAt` | date | | 任务实际开始时间 |
| `finishedAt` | date | | 任务完成时间 |
| `durationMs` | number | | 执行耗时（毫秒） |
| `message` | textarea | | 最终结果说明或错误摘要 |
| `logs` | json | | 详细日志数组，格式 `[{time, level, msg}]` |
| `agentTaskRun` | relationship | | 若由 agent-task 触发，关联该 run → `agent-task-runs` |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 触发索引后轮询进度（indexRunId=5）
curl -s 'http://localhost:3000/api/kb-index-runs/5' \
  -H "Authorization: JWT $TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d['phase'], str(d['progress'])+'%')"

# 查看某知识库最近 5 条运行记录
curl -s 'http://localhost:3000/api/kb-index-runs?where[knowledgeBase][equals]=1&sort=-createdAt&limit=5' \
  -H "Authorization: JWT $TOKEN"
```

---

## `ai-models`

**功能**：AI 模型连接配置中心。每条记录代表一个可用的模型端点，分为 `text`（语言模型，用于内容生成）和 `embedding`（向量模型，用于知识库索引）两类。支持 OpenAI、Anthropic、DeepSeek（openai-compatible 方式）等多种 provider。

**端点基址**：`/api/ai-models`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 模型配置名称（如 "DeepSeek V4 Pro"） |
| `modelType` | select | ✓ | 用途类型：`text`（语言生成）/ `embedding`（向量化）/ `image` / `video` |
| `provider` | select | ✓ | 服务商：`openai` / `anthropic` / `openai-compatible`（兼容 OpenAI 协议的第三方，如 DeepSeek）/ `zhipu` / `bytedance` / `local` |
| `modelId` | text | ✓ | 模型 ID 字符串（如 `deepseek-chat`、`gpt-4o`、`text-embedding-3-small`） |
| `baseUrl` | text | | 自定义 API 地址，openai-compatible 时必填（如 `https://api.deepseek.com`） |
| `apiKey` | text | | API Key，存储为明文（仅服务端使用，响应中不返回） |
| `temperature` | number | | 生成温度（0-2），越高越随机，默认 1.0 |
| `maxTokens` | number | | 单次调用最大 token 数 |
| `embeddingDimensions` | number | | 向量维度（embeddingModel 时填写，如 1536） |
| `dailyRequestLimit` | number | | 每日请求次数上限（0 表示不限） |
| `dailyTokenLimit` | number | | 每日 token 消耗上限（0 表示不限） |
| `priority` | number | | 优先级，多模型可用时数值越高越优先被选中 |
| `isActive` | checkbox | | 是否启用，`false` 时系统不会选用该模型 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/ai-models/test-connection` | **测试模型连接**。验证当前配置能否成功调用模型 API，返回是否通过及延迟信息 |

**示例：**

```bash
# 创建 DeepSeek 模型配置
curl -X POST 'http://localhost:3000/api/ai-models' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "name": "DeepSeek V4 Pro",
    "modelType": "text",
    "provider": "openai-compatible",
    "modelId": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "sk-xxx",
    "temperature": 0.7,
    "isActive": true
  }'

# 查询所有可用 embedding 模型
curl -s 'http://localhost:3000/api/ai-models?where[modelType][equals]=embedding&where[isActive][equals]=true' \
  -H "Authorization: JWT $TOKEN"
```

---

## `prompts`

**功能**：Prompt 模板库。每个 prompt 定义一套可复用的提示词，包含 `systemPrompt`（系统人设）和 `userTemplate`（用户消息模板，支持 `{{variable}}` 占位符）。tasks 和 agent-tasks 通过关联 prompt 来驱动 AI 生成内容。

**端点基址**：`/api/prompts`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 模板名称 |
| `slug` | text | | 全局唯一标识符，用于代码中引用 |
| `category` | select | | 用途分类：`content`（内容生成）/ `title`（标题生成）/ `summary`（摘要）/ `seo`（SEO优化）/ `review`（审稿）/ `system`（系统级） |
| `systemPrompt` | textarea | | 系统提示词（AI 角色设定、行为规则）。填写后作为 system message 发送 |
| `userTemplate` | textarea | ✓ | 用户消息模板。支持 `{{key}}` 占位符，运行时被变量值替换 |
| `variables` | array | | 模板变量定义列表 |
| `variables[].key` | text | ✓ | 变量名，对应 `{{key}}` 占位符 |
| `variables[].description` | text | | 变量的含义说明 |
| `variables[].defaultValue` | text | | 变量默认值 |
| `preferredModel` | relationship | | 推荐使用的模型 → `ai-models` |
| `version` | number | | 版本号，人工维护，便于跟踪变更历史 |
| `isActive` | checkbox | | 是否启用 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建摘要生成 Prompt
curl -X POST 'http://localhost:3000/api/prompts' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "name": "文章摘要生成",
    "slug": "generate-excerpt",
    "category": "summary",
    "systemPrompt": "你是一个专业的内容编辑，擅长提炼文章核心观点。",
    "userTemplate": "请为以下文章生成一段 100 字以内的摘要：\n\n{{content}}",
    "variables": [{"key":"content","description":"文章正文"}],
    "isActive": true
  }'
```

---

## `categories`

**功能**：文章分类目录，支持树形层级结构（通过 `parent` 自关联）。`sortOrder` 控制同级分类的展示顺序。`isActive=false` 的分类不对外展示但保留数据。

**端点基址**：`/api/categories`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 分类名称 |
| `slug` | text | ✓ | URL 标识符，全局唯一 |
| `description` | textarea | | 分类描述 |
| `parent` | relationship | | 父级分类（自关联）→ `categories`。顶级分类该字段为空 |
| `sortOrder` | number | | 同级分类中的排列顺序，数值越小越靠前 |
| `isActive` | checkbox | | 是否启用（对外可见） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建父级分类
curl -X POST 'http://localhost:3000/api/categories' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"name":"科技","slug":"tech","isActive":true,"sortOrder":1}'

# 创建子分类（parent=1 表示父级 id=1）
curl -X POST 'http://localhost:3000/api/categories' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"name":"人工智能","slug":"ai","parent":1,"isActive":true,"sortOrder":1}'

# 获取完整分类树
curl -s 'http://localhost:3000/api/categories?depth=2&sort=sortOrder' \
  -H "Authorization: JWT $TOKEN"
```

---

## `articles`

**功能**：核心内容实体。支持草稿/发布两阶段工作流（Payload versions + drafts），通过 `_status` 区分草稿和已发布版本。`reviewStatus` 实现独立的人工审核工作流。文章可追踪其来源（`sourceTask` / `sourceTitle`），便于分析 AI 生产链路效果。

**特性**：versions（草稿/发布版本控制）

**端点基址**：`/api/articles`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `title` | text | ✓ | 文章标题 |
| `slug` | text | ✓ | URL 标识符，全局唯一。发布后通常不修改 |
| `excerpt` | textarea | | 文章摘要（150-300字），用于列表展示和 SEO description |
| `content` | richText | | 文章正文（Lexical 富文本格式，JSON 存储） |
| `status` | select | | 编辑状态：`draft`（草稿）/ `pending-review`（待审核）/ `published`（已发布）/ `archived`（已归档） |
| `reviewStatus` | select | | 人工审核状态：`unreviewed`（未审）/ `approved`（通过）/ `rejected`（拒绝） |
| `author` | relationship | | 署名作者 → `authors` |
| `category` | relationship | | 所属分类 → `categories` |
| `keywords` | relationship | | 关联关键词（多个）→ `keywords`（hasMany） |
| `coverImage` | upload | | 封面图 → `images` |
| `inlineImages` | relationship | | 正文插图（多个）→ `images`（hasMany） |
| `seo` | group | | SEO 元数据组 |
| `seo.metaTitle` | text | | SEO 标题（不填则用 title） |
| `seo.metaDescription` | textarea | | SEO 描述（不填则用 excerpt） |
| `seo.metaKeywords` | text | | SEO 关键词（逗号分隔） |
| `seo.ogImage` | upload | | Open Graph 分享图 → `images` |
| `isAiGenerated` | checkbox | | 是否由 AI 生成（用于数据统计与标记） |
| `isFeatured` | checkbox | | 是否为精选文章（用于首页/专题展示） |
| `isHot` | checkbox | | 是否为热门文章 |
| `sourceTask` | relationship | | 生成该文章的任务 → `tasks`（用于追踪生产链路） |
| `sourceTitle` | relationship | | 使用的标题记录 → `titles` |
| `viewCount` | number | | 浏览次数（由前端上报） |
| `publishedAt` | date | | 发布时间（可手动设置，不一定等于 updatedAt） |
| `_status` | select | | Payload 内部草稿状态：`draft` / `published`。通过 versions 机制控制 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

> **草稿与发布**：PATCH 默认更新草稿。要发布需将 `_status` 设为 `published`。查询时加 `draft=true` 返回草稿，否则返回已发布版本。

**示例：**

```bash
# 创建草稿文章
curl -X POST 'http://localhost:3000/api/articles' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "title": "AI 时代的内容生产",
    "slug": "ai-content-production",
    "excerpt": "本文探讨AI如何改变内容生产流程",
    "status": "draft",
    "isAiGenerated": true,
    "author": 1,
    "category": 1
  }'

# 发布文章
curl -X PATCH 'http://localhost:3000/api/articles/1' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"_status":"published","status":"published","publishedAt":"2026-04-30T10:00:00.000Z"}'

# 查询已发布文章（按发布时间倒序）
curl -s 'http://localhost:3000/api/articles?where[status][equals]=published&sort=-publishedAt&depth=1' \
  -H "Authorization: JWT $TOKEN"

# 查询草稿
curl -s 'http://localhost:3000/api/articles?draft=true&where[_status][equals]=draft' \
  -H "Authorization: JWT $TOKEN"
```

---

## `article-reviews`

**功能**：文章人工审核记录。每次审核操作生成一条记录，包含审核决定（通过/拒绝/需修改）和评语。`flaggedKeywords` 存储审核中发现的问题词语，便于作者修改。

**端点基址**：`/api/article-reviews`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `article` | relationship | ✓ | 审核的文章 → `articles` |
| `reviewer` | relationship | | 审核人 → `users` |
| `decision` | select | ✓ | 审核决定：`approved`（通过）/ `rejected`（拒绝）/ `needs-revision`（需要修改） |
| `comment` | textarea | | 审核意见和说明 |
| `flaggedKeywords` | text | | 发现的问题词语（逗号分隔） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 提交审核通过
curl -X POST 'http://localhost:3000/api/article-reviews' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "article": 1,
    "reviewer": 1,
    "decision": "approved",
    "comment": "内容质量良好，逻辑清晰"
  }'
```

---

## `tasks`

**功能**：内容生产任务的配置中心。一个 task 定义了完整的 AI 写作流水线：选哪个 prompt、用哪个模型、从哪个素材库取关键词/标题/图片/知识库、以什么作者署名、按什么节奏发布。通过 `POST /api/tasks/:id/run` 手动触发，或通过 `task-schedules` 自动定时运行。

**端点基址**：`/api/tasks`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 任务名称 |
| `description` | textarea | | 任务描述 |
| `status` | select | | 任务状态：`inactive`（未激活）/ `active`（激活可运行）/ `paused`（暂停）/ `completed`（已完成）/ `failed`（失败） |
| `titleLibrary` | relationship | | 从哪个标题库取标题 → `title-libraries` |
| `keywordLibrary` | relationship | | 从哪个关键词库取关键词 → `keyword-libraries` |
| `imageLibrary` | relationship | | 从哪个图片库选封面 → `image-libraries` |
| `knowledgeBases` | relationship | | RAG 知识库（多个）→ `knowledge-bases`（hasMany） |
| `prompt` | relationship | | 使用的 Prompt 模板 → `prompts` |
| `aiModel` | relationship | | 使用的 AI 模型 → `ai-models` |
| `authorMode` | select | | 作者分配方式：`fixed`（固定使用 authors[0]）/ `rotate`（轮换使用 authors 列表） |
| `authors` | relationship | | 可用作者列表（多个）→ `authors`（hasMany） |
| `categoryMode` | select | | 分类方式：`fixed`（固定分类）/ `auto`（AI 自动判断） |
| `category` | relationship | | 固定分类（categoryMode=fixed 时生效）→ `categories` |
| `publishingPace.articlesPerDay` | number | | 每天发布篇数 |
| `publishingPace.minIntervalMinutes` | number | | 两篇文章之间的最短间隔（分钟） |
| `publishingPace.maxIntervalMinutes` | number | | 最长间隔（分钟），实际间隔随机分布于 min-max 之间 |
| `autoPublish` | checkbox | | 生成后是否自动发布（否则生成 draft 等待人工发布） |
| `lastRunAt` | date | | 最近一次运行时间 |
| `totalRuns` | number | | 累计运行次数 |
| `totalArticles` | number | | 累计生产文章数 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/tasks/:id/run` | **手动触发任务**。创建 `task-runs` 记录并入队 `processTaskRun` 任务。响应：`{success, jobId, taskRunId}` |

**示例：**

```bash
# 手动触发任务（id=1）
curl -X POST 'http://localhost:3000/api/tasks/1/run' \
  -H "Authorization: JWT $TOKEN"
# 响应：{"success":true,"jobId":"xxx","taskRunId":5}

# 查看任务执行结果
curl -s 'http://localhost:3000/api/task-runs/5' -H "Authorization: JWT $TOKEN"
```

---

## `task-runs`

**功能**：每次 task 执行的运行记录和日志。记录开始/结束时间、Token 消耗、生成的文章列表、完整日志文本和错误信息。

**端点基址**：`/api/task-runs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `task` | relationship | ✓ | 所属任务 → `tasks` |
| `status` | select | | 运行状态：`queued`/ `running`/ `success`/ `failed`/ `cancelled` |
| `startedAt` | date | | 任务实际开始时间 |
| `finishedAt` | date | | 完成时间 |
| `durationMs` | number | | 执行耗时（毫秒） |
| `articlesCreated` | relationship | | 本次生产的文章列表 → `articles`（hasMany） |
| `tokenUsage` | json | | Token 消耗统计：`{promptTokens, completionTokens, totalTokens}` |
| `logs` | textarea | | 完整执行日志文本 |
| `errorMessage` | textarea | | 失败时的错误信息 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `task-schedules`

**功能**：定时任务配置，通过 Cron 表达式自动触发指定 task。`nextRunAt` 由系统自动计算，`lastRunAt` 记录上次触发时间。

**端点基址**：`/api/task-schedules`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 调度名称 |
| `task` | relationship | ✓ | 触发的任务 → `tasks` |
| `cron` | text | ✓ | Cron 表达式（5位），如 `0 9 * * *`（每天09:00）、`0 */6 * * *`（每6小时） |
| `timezone` | text | | 时区，默认 UTC。推荐填 `Asia/Shanghai` |
| `isActive` | checkbox | | 是否启用，`false` 时不触发 |
| `lastRunAt` | date | | 上次触发时间 |
| `nextRunAt` | date | | 下次预计触发时间（系统自动计算） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建每天 9:00（北京时间）触发的调度
curl -X POST 'http://localhost:3000/api/task-schedules' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "name": "每日早间内容生产",
    "task": 1,
    "cron": "0 9 * * *",
    "timezone": "Asia/Shanghai",
    "isActive": true
  }'
```

---

## `worker-heartbeats`

**功能**：后台 Worker 进程的健康监控记录。每个 worker 进程定期上报心跳，系统据此判断 worker 是否在线。`status` 和 `lastHeartbeatAt` 是关键监控指标。

**端点基址**：`/api/worker-heartbeats`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `workerId` | text | ✓ | Worker 唯一标识（通常为 UUID），全局唯一 |
| `queue` | text | | 该 worker 监听的队列名称 |
| `hostname` | text | | 运行主机名 |
| `pid` | number | | 进程 ID |
| `status` | select | | 状态：`idle`（空闲等待任务）/ `busy`（正在处理任务）/ `offline`（已离线） |
| `lastHeartbeatAt` | date | | 最近一次心跳时间。若超过阈值未更新，视为 offline |
| `metrics` | json | | 性能指标，格式 `{cpuPercent, memoryMB, jobsProcessed}` |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `agent-skills`

**功能**：Agent 技能包的上传和管理。上传 zip 压缩包（内含 SKILL.md 和相关脚本），系统自动解析 SKILL.md 提取名称、描述和文件列表。解析后的内容存入 `content` 和 `rawSkillMd` 字段，供 agent-tasks 运行时使用。

**特性**：upload（multipart/form-data，接受 zip 包）

**端点基址**：`/api/agent-skills`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 技能名称（从 SKILL.md 解析） |
| `slug` | text | | 全局唯一标识符 |
| `description` | textarea | | 技能描述（从 SKILL.md 解析） |
| `isActive` | checkbox | | 是否启用 |
| `content` | code | | 解析后的技能主体内容（Markdown/代码） |
| `rawSkillMd` | code | | SKILL.md 原始文本 |
| `fileCount` | number | | 压缩包内文件数量 |
| `files` | array | | 文件列表：每项含 `path`（文件路径）、`id` |
| `url` | text | | 上传 zip 文件的访问 URL |
| `filename` | text | | 上传文件名 |
| `mimeType` | text | | MIME 类型 |
| `filesize` | number | | 文件大小（字节） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/agent-skills` | 上传 zip 技能包，Content-Type: multipart/form-data，字段名 `file` |
| GET | `/api/agent-skills/:id/files-info` | 获取指定技能包内的文件列表详情（路径、大小等） |
| GET | `/api/agent-skills/file/:filename` | 直接下载技能包文件 |

---

## `agent-tasks`

**功能**：Agent 任务定义。每个 agent-task 配置一个可复用的 AI Agent 工作单元：绑定到特定 collection（`boundCollection`），运行时从当前文档字段读取输入变量，执行 prompt + tools，将结果写回指定字段（`targetFieldPath`）。典型用途：为 KB 抓取 URL 内容、为文章生成摘要等。

**端点基址**：`/api/agent-tasks`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 任务名称（Admin 面板显示） |
| `slug` | text | | URL 友好标识符，全局唯一。支持按 slug 触发：`POST /api/agent-tasks/:slug/run` |
| `boundCollection` | text | | 绑定的 collection slug（如 `knowledge-bases`），决定在哪些文档的编辑页面显示此任务按钮 |
| `targetFieldPath` | text | | 任务输出写入的字段路径（如 `rawContent`），支持点分隔嵌套路径 |
| `prompt` | textarea | ✓ | Agent 的系统提示词 + 任务指令 |
| `variables` | array | | 输入变量定义列表 |
| `variables[].key` | text | ✓ | 变量名（对应 `inputs` 对象的 key） |
| `variables[].label` | text | | 变量显示名称（Admin 面板） |
| `variables[].fieldPath` | text | | 从当前文档的哪个字段自动读取值（如 `sourceUrl`） |
| `variables[].defaultValue` | text | | 变量默认值 |
| `variables[].description` | textarea | | 变量含义说明 |
| `outputMode` | select | | 输出模式：`text`（文本写回 targetFieldPath）/ `file`（输出为文件） |
| `skills` | relationship | | 提供给 Agent 的技能包（多个）→ `agent-skills`（hasMany） |
| `aiModel` | relationship | ✓ | 使用的 AI 模型 → `ai-models` |
| `maxSteps` | number | | Agent 最大执行步数（防止无限循环），默认 10 |
| `timeoutMs` | number | | 单次运行超时时间（毫秒），默认 300000（5分钟）。超时后抛出 'agent execution timed out'，run status 变为 failed |
| `enableBash` | checkbox | | 是否允许 Agent 执行 bash 命令（需谨慎启用） |
| `lastRunAt` | date | | 最近一次运行时间 |
| `lastRunStatus` | select | | 最近运行状态：`idle`/ `queued`/ `running`/ `success`/ `failed` |
| `totalRuns` | number | | 累计运行次数 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/agent-tasks/:id/run` | **触发 Agent 任务**。`:id` 可以是数字 ID 或 `slug` 字符串。可选 Body: `{"inputs": {"key": "value"}}` 手动传入变量。响应：`{success, taskRunId, jobId}` |

**示例：**

```bash
# 按 ID 触发（为 knowledge-base 抓取 URL）
curl -X POST 'http://localhost:3000/api/agent-tasks/1/run' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"inputs":{"url":"https://example.com/article","knowledgeBaseId":"1"}}'

# 按 slug 触发（更稳定）
curl -X POST 'http://localhost:3000/api/agent-tasks/fetch-url-to-markdown/run' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{"inputs":{"url":"https://example.com/article"}}'
# 响应：{"success":true,"taskRunId":12,"jobId":"def456"}
```

---

## `agent-task-runs`

**功能**：Agent 任务每次执行的详细日志。`steps` 字段存储 Agent 执行的每一步（工具调用、模型输出等），是调试 Agent 行为的主要数据来源。`effectivePrompt` 记录实际发送给模型的完整提示词（变量替换后）。

**端点基址**：`/api/agent-task-runs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `agentTask` | relationship | ✓ | 所属任务 → `agent-tasks` |
| `status` | select | | 运行状态：`queued`/ `running`/ `success`/ `failed` |
| `startedAt` | date | | 实际开始时间 |
| `finishedAt` | date | | 完成时间 |
| `durationMs` | number | | 执行耗时（毫秒） |
| `inputs` | json | | 运行时传入的输入变量，格式 `{key: value}` |
| `effectivePrompt` | textarea | | 变量替换后实际发送给模型的完整 prompt |
| `linkedKnowledgeBase` | relationship | | 若任务结果写入了知识库，关联此 → `knowledge-bases` |
| `finalOutput` | textarea | | Agent 最终输出的文本结果 |
| `errorMessage` | textarea | | 失败时的错误信息 |
| `steps` | json | | Agent 执行步骤数组。每步包含：`{type, toolName?, toolInput?, toolOutput?, text?, usage?}` |
| `stepCount` | number | | 总步骤数 |
| `totalTokens` | number | | 总 Token 消耗 |
| `promptTokens` | number | | 输入 Token 数 |
| `completionTokens` | number | | 输出 Token 数 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 轮询等待 Agent 运行完成（taskRunId=12）
curl -s 'http://localhost:3000/api/agent-task-runs/12' \
  -H "Authorization: JWT $TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d.get('finalOutput','')[:200])"
```

---

## `sensitive-words`

**功能**：内容审核敏感词库。定义词语的敏感级别和处理动作，用于文章发布前的自动检测。`action` 决定检测到该词时的行为，`replacement` 仅在 `action=replace` 时使用。

**端点基址**：`/api/sensitive-words`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `word` | text | ✓ | 敏感词文本，全局唯一 |
| `severity` | select | | 严重程度：`low`（低，仅标记）/ `medium`（中）/ `high`（高，阻止发布） |
| `action` | select | | 处理动作：`flag`（标记供人工审核）/ `replace`（自动替换）/ `block`（直接拒绝发布） |
| `replacement` | text | | action=replace 时的替换文本（如 `***`） |
| `category` | text | | 词语分类（如"政治"、"暴力"、"广告"），用于分组管理 |
| `isActive` | checkbox | | 是否启用该规则 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `activity-logs`

**功能**：用户操作的审计日志。记录每次有意义的用户行为（登录、创建、更新、删除等），含操作者身份、目标对象、客户端信息。用于安全审计和操作追溯，通常只读。

**端点基址**：`/api/activity-logs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `user` | relationship | | 操作人 → `users`（匿名操作为空） |
| `action` | text | ✓ | 操作类型（如 `create`, `update`, `delete`, `login`, `publish`） |
| `targetType` | text | | 操作对象的 collection slug（如 `articles`） |
| `targetId` | text | | 操作对象的 ID |
| `ip` | text | | 客户端 IP 地址 |
| `userAgent` | text | | 客户端 User-Agent 字符串 |
| `metadata` | json | | 操作附加信息（如变更前后值、额外上下文） |
| `createdAt` | date | ✓ | 自动（即操作发生时间） |
| `updatedAt` | date | ✓ | 自动 |

---

## `system-logs`

**功能**：应用系统级日志，由代码主动写入（非用户操作触发）。记录服务器错误、后台任务异常、第三方 API 调用失败等。`level` 区分日志严重程度，`channel` 标识日志来源模块，`stack` 保存完整错误堆栈。

**端点基址**：`/api/system-logs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `level` | select | ✓ | 日志级别：`debug`/ `info`/ `warning`/ `error`/ `critical` |
| `channel` | text | | 日志来源模块（如 `ai-model`, `kb-indexer`, `agent-task`） |
| `message` | text | ✓ | 日志摘要信息 |
| `context` | json | | 详细上下文数据（结构化，便于查询） |
| `stack` | textarea | | Error 堆栈跟踪（仅 error/critical 级别填写） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 查看最近错误日志
curl -s 'http://localhost:3000/api/system-logs?where[level][in][0]=error&where[level][in][1]=critical&sort=-createdAt&limit=20' \
  -H "Authorization: JWT $TOKEN"
```

---

## `url-import-jobs`

**功能**：批量 URL 导入任务。支持三种来源：直接提供 URL 列表（`list`）、RSS/Atom Feed（`feed`）、网站 Sitemap（`sitemap`）。每个 job 可同时将内容导入到文章和/或知识库。详细结果见 `url-import-job-logs`。

**端点基址**：`/api/url-import-jobs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | ✓ | 导入任务名称 |
| `sourceType` | select | | 来源类型：`list`（手动 URL 列表）/ `feed`（RSS/Atom Feed URL）/ `sitemap`（网站 Sitemap URL） |
| `urls` | array | | sourceType=list 时的 URL 列表，每项含 `url` 字段 |
| `feedUrl` | text | | sourceType=feed/sitemap 时的 Feed 或 Sitemap URL |
| `targetCategory` | relationship | | 导入文章的目标分类 → `categories` |
| `targetKnowledgeBase` | relationship | | 导入内容写入的目标知识库 → `knowledge-bases` |
| `status` | select | | 任务状态：`pending`/ `running`/ `completed`/ `failed` |
| `totalUrls` | number | | 总 URL 数量 |
| `processedUrls` | number | | 已处理数量（成功+失败） |
| `failedUrls` | number | | 处理失败数量 |
| `startedAt` | date | | 任务开始时间 |
| `finishedAt` | date | | 任务完成时间 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建批量 URL 导入任务
curl -X POST 'http://localhost:3000/api/url-import-jobs' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "name": "竞品内容采集",
    "sourceType": "list",
    "urls": [
      {"url": "https://example.com/article-1"},
      {"url": "https://example.com/article-2"}
    ],
    "targetKnowledgeBase": 1
  }'
```

---

## `url-import-job-logs`

**功能**：`url-import-jobs` 中每条 URL 的详细处理结果。记录 HTTP 状态、抓取到的标题、内容长度、创建的文章/知识库 ID 以及失败原因。

**端点基址**：`/api/url-import-job-logs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `job` | relationship | ✓ | 所属导入任务 → `url-import-jobs` |
| `url` | text | ✓ | 处理的 URL |
| `status` | select | ✓ | 处理结果：`success`（成功）/ `failed`（失败）/ `skipped`（已存在跳过） |
| `httpStatus` | number | | HTTP 响应状态码（200/404/500 等） |
| `extractedTitle` | text | | 从页面提取的标题 |
| `contentLength` | number | | 抓取到的内容长度（字符数） |
| `createdArticle` | relationship | | 成功时创建的文章 → `articles` |
| `createdKnowledgeBase` | relationship | | 成功时创建/更新的知识库 → `knowledge-bases` |
| `errorMessage` | textarea | | 失败时的错误说明 |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

---

## `payload-mcp-api-keys`

**功能**：MCP（Model Context Protocol）客户端的 API Key 管理。每个 API Key 绑定一个 user，通过细粒度权限矩阵控制该 Key 可访问的 collection 操作（find/create/update）。MCP 客户端使用 `Authorization: Bearer <apiKey>` 方式调用 API，无需完整的用户密码。

**特性**：auth（需 enableAPIKey=true 激活）

**端点基址**：`/api/payload-mcp-api-keys`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `user` | relationship | ✓ | 关联的用户账号 → `users` |
| `label` | text | | Key 的名称标签（如"Claude MCP Key"） |
| `description` | text | | 用途描述 |
| `enableAPIKey` | checkbox | | 是否启用 API Key 鉴权 |
| `apiKey` | text | | API Key 值（创建后请妥善保存） |
| `articles` | group | | articles 权限：`{find, create, update}` 各为 checkbox |
| `tasks` | group | | tasks 权限：`{find, create, update}` |
| `prompts` | group | | prompts 权限：`{find, create, update}` |
| `knowledgeBases` | group | | knowledge-bases 权限：`{find}` |
| `titles` | group | | titles 权限：`{find, create, update}` |
| `keywords` | group | | keywords 权限：`{find, create, update}` |
| `categories` | group | | categories 权限：`{find}` |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

**示例：**

```bash
# 创建 MCP API Key
curl -X POST 'http://localhost:3000/api/payload-mcp-api-keys' \
  -H 'Content-Type: application/json' \
  -H "Authorization: JWT $TOKEN" \
  -d '{
    "user": 1,
    "label": "Claude MCP Client",
    "enableAPIKey": true,
    "articles": {"find": true, "create": true, "update": true},
    "knowledgeBases": {"find": true}
  }'

# 使用 API Key 调用（Bearer 方式）
curl -s 'http://localhost:3000/api/articles?limit=5' \
  -H 'Authorization: Bearer <your-api-key-here>'
```

---

## `payload-kv`

**功能**：通用键值对存储（Payload 内置）。用于存储系统内部的配置、缓存、状态等结构化数据。`key` 全局唯一，`data` 支持任意 JSON 结构。通常由系统内部代码使用。

**端点基址**：`/api/payload-kv`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `key` | text | ✓ | 唯一键名（建议使用命名空间，如 `system:last-schedule-check`） |
| `data` | json | ✓ | 存储的任意 JSON 数据 |

---

## `payload-jobs`

**功能**：Payload 内置的后台任务队列。所有异步任务（知识库索引、Agent 任务、内容生产等）都通过此队列调度执行。`taskSlug` 区分任务类型，`processing` 标记当前是否有 worker 正在处理。`log` 数组记录每次执行尝试的详情。

**端点基址**：`/api/payload-jobs`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `taskSlug` | select | | 任务类型：`indexKnowledgeBase`/ `embedKnowledgeChunk`/ `processAgentTaskRun`/ `processTaskRun`/ `importUrlBatch`/ `inline` |
| `input` | json | | 任务输入参数（如 `{knowledgeBaseId, indexRunId}`） |
| `taskStatus` | json | | 当前任务状态摘要 |
| `processing` | checkbox | | 是否有 worker 正在处理（`true` 时不会被其他 worker 抢占） |
| `hasError` | checkbox | | 是否执行过程中出现错误 |
| `error` | json | | 最终错误信息 |
| `totalTried` | number | | 已尝试执行次数 |
| `completedAt` | date | | 完成时间 |
| `waitUntil` | date | | 延迟执行的最早时间 |
| `log` | array | | 执行日志数组，每项记录一次执行尝试的详情 |
| `log[].taskSlug` | select | ✓ | 执行的任务类型 |
| `log[].state` | radio | ✓ | 执行结果：`succeeded` / `failed` |
| `log[].executedAt` | date | ✓ | 开始执行时间 |
| `log[].completedAt` | date | ✓ | 完成时间 |
| `log[].input` | json | | 输入参数快照 |
| `log[].output` | json | | 输出结果快照 |
| `log[].error` | json | | 错误信息（state=failed 时） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/payload-jobs/run` | **手动触发 worker 执行一批任务**（通常由系统内部或 cron 调用） |
| GET | `/api/payload-jobs/handle-schedules` | **处理调度任务**，检查 `task-schedules` 并触发到期的定时任务 |

**示例：**

```bash
# 查看队列中待处理的任务
curl -s 'http://localhost:3000/api/payload-jobs?where[processing][equals]=false&where[completedAt][exists]=false&sort=-createdAt' \
  -H "Authorization: JWT $TOKEN"

# 查看失败的任务
curl -s 'http://localhost:3000/api/payload-jobs?where[hasError][equals]=true&sort=-createdAt' \
  -H "Authorization: JWT $TOKEN"

# 查看特定类型任务
curl -s 'http://localhost:3000/api/payload-jobs?where[taskSlug][equals]=indexKnowledgeBase&sort=-createdAt&limit=10' \
  -H "Authorization: JWT $TOKEN"
```

---

## `payload-locked-documents`

**功能**：Payload 内置的文档编辑锁机制。当用户在 Admin 面板打开某个文档时，系统自动创建锁记录，防止多人同时编辑冲突。关闭或保存文档后自动释放。通常无需通过 API 手动操作。

**端点基址**：`/api/payload-locked-documents`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `document` | relationship | | 被锁定的文档（多态关联，可指向任意 collection） |
| `globalSlug` | text | | 若锁定的是 global 而非 collection 文档，存储 global slug |
| `user` | relationship | ✓ | 持有锁的用户 → `users` 或 `payload-mcp-api-keys` |
| `createdAt` | date | ✓ | 自动（加锁时间） |
| `updatedAt` | date | ✓ | 自动 |

---

## `payload-preferences`

**功能**：Payload 内置的用户 UI 偏好存储。Admin 面板使用它保存每个用户的界面设置（如侧边栏折叠状态、列表排序偏好等）。通常无需手动操作。

**端点基址**：`/api/payload-preferences`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `user` | relationship | ✓ | 所属用户 → `users` 或 `payload-mcp-api-keys` |
| `key` | text | | 偏好项的键名（如 `collection-articles-columns`） |
| `value` | json | | 偏好值（任意 JSON） |
| `createdAt` | date | ✓ | 自动 |
| `updatedAt` | date | ✓ | 自动 |

### 自定义端点

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/payload-preferences/:key` | 按 key 获取当前用户的某项偏好设置 |
| POST | `/api/payload-preferences/:key` | 按 key 创建或更新某项偏好 |
| DELETE | `/api/payload-preferences/:key` | 删除某项偏好 |

---

## `payload-migrations`

**功能**：Payload 内置的数据库迁移记录。每次执行 `pnpm payload migrate` 后生成记录，追踪哪些迁移已执行及其批次号。用于数据库版本管理，**请勿手动修改**。

**端点基址**：`/api/payload-migrations`

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `id` | number | ✓ | 主键 |
| `name` | text | | 迁移文件名（如 `20260101_000000_add_knowledge_bases`） |
| `batch` | number | | 批次号，同一次 `migrate` 命令执行的迁移共享同一批次号 |
| `createdAt` | date | ✓ | 迁移执行时间 |
| `updatedAt` | date | ✓ | 自动 |
