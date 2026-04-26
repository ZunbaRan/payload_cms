import React from 'react'
import Link from 'next/link'

export default function HomePage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Finly AI-Native 复刻项目</h1>
      <p>基于 Payload CMS 实现 Finly 博文中的 AI-Native 核心模式。</p>
      <ul>
        <li><Link href="/admin">Admin 后台</Link> — 管理笔记、查看 Token 用量、配置 AI Prompt</li>
        <li><Link href="/admin/globals/ai-config">AI 配置 Global</Link> — 无代码修改 Prompt 和模型</li>
        <li><Link href="/admin/collections/token-usages">Token 用量</Link> — 审查每次 AI 调用的完整消息</li>
        <li><Link href="/api/search?q=示例">语义搜索 API</Link> — /api/search?q=你的查询</li>
      </ul>
      <h2>已实现功能</h2>
      <ul>
        <li>✅ AiConfig Global — Prompt 模板 & 模型选择（Admin 无代码配置）</li>
        <li>✅ TokenUsage Collection — Token 用量 & 完整消息追踪</li>
        <li>✅ processNote Job — 标签生成 + 重要性判断 + Chroma 向量化</li>
        <li>✅ Chroma 语义搜索 — /api/search</li>
      </ul>
    </main>
  )
}
