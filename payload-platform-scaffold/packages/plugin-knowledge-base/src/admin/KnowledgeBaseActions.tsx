'use client'
import { useDocumentInfo, useAllFormFields } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * KnowledgeBase 详情页右上动作按钮：
 *   - 📚 开始索引       → POST /api/knowledge-bases/:id/reindex
 *   - 🌐 用 Agent 抓取  → POST /api/knowledge-bases/:id/fetch-via-agent  (仅 sourceType=url + 配置了 fetchAgentTask)
 */
const KnowledgeBaseActions: React.FC = () => {
  const { id } = useDocumentInfo()
  const [fields] = useAllFormFields()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  if (!id) return null

  const sourceType = (fields?.sourceType?.value as string | undefined) || 'manual'
  const hasFetchAgent = Boolean(fields?.fetchAgentTask?.value)

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
        marginTop: 16,
        padding: 12,
        border: '1px solid var(--theme-border-color)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {sourceType === 'url' && (
        <button
          type="button"
          disabled={!hasFetchAgent || busy !== null}
          onClick={() => post('/fetch-via-agent', '抓取')}
          className="btn btn--style-secondary btn--size-medium"
          style={{ width: '100%' }}
          title={hasFetchAgent ? '' : '请先在下方选择「抓取 Agent 任务」并保存'}
        >
          {busy === '抓取' ? '抓取入队中…' : '🌐 用 Agent 抓取来源 URL'}
        </button>
      )}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => post('/reindex', '索引')}
        className="btn btn--style-primary btn--size-medium"
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
