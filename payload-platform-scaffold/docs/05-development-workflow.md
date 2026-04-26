# 开发流程

## 1. 复制脚手架

```bash
cp -R payload-platform-scaffold my-payload-app
cd my-payload-app
```

然后全局替换命名空间：

```text
@scaffold → @your-project
payload-platform-scaffold → your-project-name
```

## 2. 安装依赖

```bash
pnpm install
```

## 3. 配置环境变量

```bash
cd apps/platform
cp .env.example .env
```

至少修改：

```text
PAYLOAD_SECRET
DATABASE_URL
NEXT_PUBLIC_SERVER_URL
```

## 4. 生成 Payload 文件

```bash
pnpm generate:importmap
pnpm generate:types
```

## 5. 启动开发

```bash
pnpm dev
```

## 6. 新增插件

复制模板：

```bash
cp -R packages/plugin-example packages/plugin-notes
```

修改：

- package name
- exported plugin function name
- collection slug
- collection fields

然后在 `apps/platform/package.json` 添加依赖：

```json
"@your-project/plugin-notes": "workspace:*"
```

最后在 `payload.config.ts` 注册：

```ts
plugins: [
  notesPlugin(),
]
```

## 7. 暴露 MCP 能力

只有当明确需要 AI Agent 使用时，才加到 `mcpPlugin`：

```ts
mcpPlugin({
  collections: {
    notes: {
      enabled: { find: true, create: true, update: true, delete: false },
      description: 'User notes that AI can search and update.',
    },
  },
})
```

## 8. 验证 MCP

启动项目后：

1. 打开 Admin
2. 创建用户
3. 进入 MCP → API Keys
4. 创建 API Key
5. 勾选允许的 collection/global/tool 权限
6. 用 MCP client 连接 `/api/mcp`

## 9. 提交前检查

建议每次功能完成后执行：

```bash
pnpm generate:types
pnpm build
```

如果改了 Admin components，再执行：

```bash
pnpm generate:importmap
```

## 10. 迁移到生产数据库

脚手架默认 SQLite，适合开发。

生产建议切换：

- Postgres adapter
- 对象存储插件
- 日志 / 审计
- 备份策略
- MCP API key 最小权限
