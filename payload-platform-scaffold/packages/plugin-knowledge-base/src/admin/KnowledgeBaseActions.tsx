'use client'
import { useDocumentInfo } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * KnowledgeBase 详情页动作按钮：
 *   - 📚 开始索引       → POST /api/knowledge-bases/:id/reindex
 *
 * 「抓取 URL」已统一到通用「🤖 AI 任务」面板（plugin-agent 自动注入），
 * 通过在 agent-task 上配置 boundCollection=knowledge-bases + targetFieldPath=rawContent 即可。
 */
const KnowledgeBaseActions: React.FC = () => {
  const { id } = useDocumentInfo()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  if (!id) return null

  const post = async (path: string, label: string) => {
    setBusy(label)
    setMsg(null)
    try {
      const res = await fetch(`/api/knowledge-bases/${id}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(`✗ ${data.error || res.statusText}`)
      } else {
        setMsg(`✓ 已入队（${label}）：jobId=${data.jobId}，去 Kb Index Runs 看进度`)
      }
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        border: '1px solid var(--theme-border-color)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => post('/reindex', '索引')}
        className="btn btn--style-primary btn--size-small"
        style={{ width: '100%' }}
      >
        {busy === '索引' ? '索引入队中…' : '📚 开始索引（切块 + 向量化）'}
      </button>
      {msg && (
        <div
          style={{
            fontSize: 12,
            color: msg.startsWith('✓') ? 'green' : 'crimson',
          }}
        >
          {msg}
        </div>
      )}
    </div>
  )
}

export default KnowledgeBaseActions
