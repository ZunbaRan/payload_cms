# AI Task 字段接入实现指导

> 面向后续接入同学的操作手册。说明如何在任意 Payload CMS Collection 的编辑页面里，为某个字段添加 AI 生成按钮。

---

## 概念

**AI Task 字段按钮**：在 Admin 表单的某个字段旁边，渲染一个按钮。用户点击后，按钮自动读取当前表单中指定字段的值，以这些值作为输入调用一个预配置的 Agent Task，等待 agent 运行完成，然后把生成结果写回目标字段。

整个过程对数据库透明——按钮本身不产生任何数据库字段，仅在 Admin 前端交互。

---

## 前置要求

1. 项目已安装并启用 `@scaffold/plugin-agent`（`agentPlugin()` 已加入 Payload 配置）。
2. 已在 Admin 里创建至少一个 AI Model（modelType 为 `text`）。
3. 已在 Admin 里创建对应的 Agent Task，并设置了稳定的 `slug`。

---

## 第一步：在 Admin 创建 Agent Task

进入 `Admin → AI Agent → Agent Tasks → 创建`，填写以下字段：

| 字段 | 填写说明 |
|------|---------|
| **任务名** | 人类可读名称，例如 `生成文章摘要` |
| **Slug** | 稳定调用标识，例如 `generate-article-excerpt`。代码里引用这个值，不要用数据库 ID |
| **任务提示词** | 告诉 agent 要做什么。用 `{{key}}` 占位符引用输入变量，例如 `根据以下文章内容，用中文写一段 80 字以内的摘要。\n\n标题：{{title}}\n\n正文：{{content}}` |
| **输入变量** | 列出 prompt 里用到的所有 `{{key}}`，方便维护 |
| **AI 模型** | 选择一个 text 类型的模型 |
| **输出模式** | 选 `text`（直接返回文本） |

保存后记住填写的 **Slug**，后续代码里会用到。

---

## 第二步：选择接入方式

有两种方式，根据目标字段类型选择：

### 方式 A：替换字段渲染组件（按钮紧贴在 textarea 下方）

适用字段类型：`textarea`

这种方式会把该字段的渲染组件替换为 `AiTaskTextareaField`，它内部先渲染原始 `TextareaField`，再在下方附加按钮。

**代码改动位置**：目标 Collection 的字段定义。

**改动前**：

```ts
{ name: 'excerpt', type: 'textarea', label: '摘要' },
```

**改动后**：

```ts
{
  name: 'excerpt',
  type: 'textarea',
  label: '摘要',
  admin: {
    components: {
      Field: {
        path: '@scaffold/plugin-agent/admin/AiTaskTextareaField#default',
        clientProps: {
          aiTask: {
            label: 'AI 生成摘要',                     // 按钮显示文字
            agentTaskId: 'generate-article-excerpt', // 第一步记下的 slug
            targetPath: 'excerpt',                   // 生成结果写入哪个字段（本字段自身）
            inputMappings: [
              { key: 'title',   fieldPath: 'title' },   // prompt 里的 {{title}} 从 title 字段读取
              { key: 'content', fieldPath: 'content' }, // prompt 里的 {{content}} 从 content 字段读取
            ],
          },
        },
      },
    },
  },
},
```

---

### 方式 B：插入独立 UI 按钮字段（适用于任意字段类型）

适用字段类型：任意（`text`、`select`、`richText`、`number` 等）

这种方式在字段列表里插入一个 `type: 'ui'` 的纯展示字段，不写入数据库，仅渲染按钮。

**代码改动位置**：目标 Collection 的字段定义，在目标字段紧接的下方插入。

**改动前**：

```ts
{ name: 'seoTitle', type: 'text', label: 'SEO 标题' },
```

**改动后**：

```ts
import { aiTaskButtonField } from '@scaffold/plugin-agent'

// ...

{ name: 'seoTitle', type: 'text', label: 'SEO 标题' },

aiTaskButtonField({
  name:          'seoTitleAiBtn',       // 唯一标识，不会写入数据库
  agentTaskId:   'generate-seo-title',  // 第一步记下的 slug
  targetPath:    'seoTitle',            // 生成结果写入哪个字段
  label:         'AI 生成 SEO 标题',   // 按钮显示文字
  inputMappings: [
    { key: 'title',       fieldPath: 'title' },
    { key: 'description', fieldPath: 'description' },
  ],
}),
```

> **注意**：`aiTaskButtonField` 是一个函数，调用后返回 Payload `Field` 对象，直接展开在 `fields` 数组里，不要再包一层对象。

---

## inputMappings 写法参考

```ts
inputMappings: [
  // 从表单中读取某个字段的当前值
  { key: 'title', fieldPath: 'title' },

  // 固定值，不从表单读取
  { key: 'lang', value: 'zh-CN' },

  // 嵌套字段（Payload group 或 array 子字段）
  { key: 'author', fieldPath: 'meta.author' },
]
```

`key` 对应 prompt 里的 `{{key}}`，`fieldPath` 对应表单里的字段路径（与 Payload 的 `useAllFormFields` key 一致，通常就是字段名，嵌套字段用点号分隔）。

---

## 可选配置项

以下配置对两种方式均有效（方式 A 写在 `clientProps.aiTask` 里，方式 B 写在 `aiTaskButtonField` 的 options 里）：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `applyMode` | `'replace' \| 'append'` | `'replace'` | `replace` 直接覆盖目标字段；`append` 在现有内容末尾追加 |
| `pollIntervalMs` | `number` | `1500` | 轮询 agent run 状态的间隔（毫秒） |
| `pollTimeoutMs` | `number` | `120000` | 等待 agent run 完成的最长时间（毫秒），超时后显示错误 |

---

## 运行时流程（自动完成，无需干预）

```
用户点击按钮
  → 从表单读取 inputMappings 中所有 fieldPath 的当前值
  → POST /api/agent-tasks/{slug}/run  { inputs: { key: value, ... } }
  → 拿到 agentTaskRunId
  → 每隔 pollIntervalMs 请求 /api/agent-task-runs/{runId}?depth=0
  → status === 'success' → 取 finalOutput
  → dispatchFields UPDATE targetPath = finalOutput
  → 按钮恢复，显示"已写入 {targetPath}"
```

如果 agent task 失败，按钮会显示错误信息，字段内容不会被改动。

---

## 验证接入是否成功

改完代码并重启 dev server 后：

1. 打开对应 Collection 的任意文档编辑页。
2. 确认字段下方（方式 A）或字段之间（方式 B）出现了对应 label 的按钮。
3. 填写好 inputMappings 涉及的源字段（比如 title、content）。
4. 点击按钮，按钮文字变为"生成中..."。
5. 等待 agent 完成（依 task 复杂度，通常 5–30 秒），目标字段自动填入生成内容。
6. 如果目标字段是 `textarea`，可以直接看到回填结果；如果是 `text`，也会实时更新。

---

## 常见问题

**按钮没有出现，显示"AI Task field missing aiTask config"**

- 检查 `clientProps.aiTask` 是否拼写正确（不是 `field.custom.aiTask`）。
- 确认 `agentTaskId` 和 `targetPath` 两个字段都不为空。

**按钮出现，但点击后立即报错**

- 检查 Agent Task 的 slug 是否与代码里的 `agentTaskId` 完全一致。
- 进 `Admin → AI Agent → Agent Tasks` 确认该 task 存在且有配置 AI 模型。

**生成内容为空**

- 检查 prompt 里的 `{{key}}` 与 inputMappings 里的 `key` 是否对应。
- 检查 inputMappings 里的 `fieldPath` 是否与表单字段名一致（大小写敏感）。
- 进 `Admin → AI Agent → Agent Task Runs` 查看最近一次 run 的日志和 finalOutput。

**方式 B 的 import 报错**

- 确认 `packages/plugin-content/package.json`（或对应业务 plugin 的 package.json）里已经把 `@scaffold/plugin-agent` 加入 `dependencies`（`workspace:*`）。

---

## 已有接入示例

`packages/plugin-content/src/collections/Articles.ts` — `excerpt` 字段，使用方式 A，调用 `generate-article-excerpt` task，读取 `title` 和 `content`，覆盖写回 `excerpt`。
