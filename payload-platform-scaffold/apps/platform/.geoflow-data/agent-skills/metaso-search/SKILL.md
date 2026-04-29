---
name: metaso-search
description: Use when user wants to search the web using Metaso (秘塔搜索), needs Chinese-friendly web search, or asks to run metaso-search.mjs script. Also use when user says "搜索一下", "查一下", "网上搜" and web-access skill's CDP is not needed.
---

# 秛塔搜索 (Metaso Search)

通过 MCP HTTP API 直接调用秘塔搜索的 `metaso_web_search` 工具，零依赖纯 Node.js。

## 快速使用

```bash
# 基本搜索
node ~/.claude/skills/metaso-search/metaso-search.mjs "搜索关键词"

# 指定数量
node ~/.claude/skills/metaso-search/metaso-search.mjs "关键词" --size 5

# 搜索论文
node ~/.claude/skills/metaso-search/metaso-search.mjs "关键词" --scope paper --summary

# 原始 JSON 输出
node ~/.claude/skills/metaso-search/metaso-search.mjs "关键词" --raw

# 最近 7 天
node ~/.claude/skills/metaso-search/metaso-search.mjs "关键词" --recency-days 7
```

## 参数速查

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `query` | string | 必填 | 搜索关键词 |
| `--scope` | enum | `webpage` | `webpage` / `document` / `paper` / `image` / `video` / `podcast` |
| `--size` | int | 20 | 返回数量 |
| `--summary` | flag | off | 包含摘要 |
| `--recency-days` | int | 无 | 最近 N 天范围 |
| `--raw` | flag | off | 输出原始 JSON |

## 适用场景

- 需要中文友好的搜索结果
- 快速搜索不需要启动浏览器 CDP
- 在脚本/管道中集成搜索能力
- 搜索学术论文（`--scope paper`）

## 与 web-access skill 的关系

这是**轻量级搜索工具**，走 MCP API 静态通道。当搜索遇到反爬、需要登录态、需要交互时，应升级到 web-access skill 的 CDP 模式。
