# MCP 设计规范

## MCP 在本架构中的角色

MCP 是 AI Agent 操作 Payload 系统的标准接口层。

```text
AI Agent
  ↓ MCP protocol
@payloadcms/plugin-mcp
  ↓ Payload Local API
Collections / Globals / Jobs
```

它不是浏览器自动化，也不是让 AI 看页面点击按钮，而是给 AI 提供结构化工具，例如：

```text
findExamples
createExamples
updateExamples
findAiConfig
updateAiConfig
```

## 是否暴露所有接口

不暴露。

本脚手架的原则是：

> MCP 默认什么都不暴露，只有被明确加入 `mcpPlugin` 配置的能力才暴露。

示例：

```ts
mcpPlugin({
  collections: {
    examples: {
      enabled: { find: true, create: true, update: true, delete: false },
      description: 'Example business records used by the scaffold template.',
    },
  },
})
```

这表示 AI 只能看到 `examples` 相关工具，而且不能 delete。

## 两层权限

Payload MCP 插件有两层控制：

### 1. 代码配置层

`mcpPlugin({ collections, globals, tools, prompts, resources })` 决定哪些能力理论上可以被 MCP 使用。

### 2. API Key 授权层

Admin UI 中的 MCP API Key 决定某个具体 key 能否使用这些能力。

即使代码里启用了 `updateExamples`，API Key 没勾选也不能调用。

## Token 成本控制

MCP 会把工具名、描述、输入 schema 暴露给 AI，这会进入模型上下文。

系统功能越多，MCP 工具越多，token 成本越高。因此：

1. 不要把所有 Collection 都暴露给 MCP。
2. 只开放 AI 真实需要的操作。
3. description 要短而准确。
4. 大 Collection 查询必须鼓励使用 `select`。
5. 对敏感或冗余字段使用 `overrideResponse` 裁剪。

## 推荐暴露策略

### 只读数据

```ts
collections: {
  documents: {
    enabled: { find: true },
    description: 'Knowledge documents available for read-only search.',
  },
}
```

### 可由 AI 创建草稿

```ts
collections: {
  tasks: {
    enabled: { find: true, create: true, update: true, delete: false },
    description: 'Task records. AI may create drafts and update status.',
  },
}
```

### Prompt 配置 Global

```ts
globals: {
  'ai-config': {
    enabled: { find: true, update: true },
    description: 'Runtime AI model and prompt configuration.',
  },
}
```

## 不建议暴露的内容

默认不要暴露：

- `users`
- API key collection
- 审计日志删除权限
- 支付、合同、敏感个人信息的 update/delete
- 内部系统配置
- 大文本全文字段的无裁剪查询

## 自定义 Tool 何时使用

当 CRUD 太底层，容易让 AI 做错时，应封装成自定义 MCP Tool。

例如不要让 AI 自己组合多个低层操作：

```text
findNotes → findDocuments → createTask → updateNote
```

可以封装成：

```text
createResearchTaskFromNote
```

这样 AI 只需要理解一个高层业务动作。

## 审计建议

生产系统中建议记录：

- MCP API key owner
- 调用的 tool
- 参数摘要
- 返回结果摘要
- 执行耗时
- 是否失败

Payload MCP 插件支持 `handlerOptions.onEvent`，可以接入审计日志。
