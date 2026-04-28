'use client'
import { useDocumentInfo } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * Agent Task 详情页右上"执行"按钮
 * 调用 POST /api/agent-tasks/:id/run
 */
const AgentTaskRunButton: React.FC = () => {
  const { id } = useDocumentInfo()
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!id) return null

  const onClick = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/agent-tasks/${id}/run`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(`✗ ${data.error || res.statusText}`)
      } else {
        setMsg(
          `✓ 已入队 (jobId: ${data.jobId}, runId: ${data.agentTaskRunId})。在 Agent Task Runs 列表查看进度`,
        )
      }
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        border: '1px solid var(--theme-border-color)',
        borderRadius: 4,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="btn btn--style-primary btn--size-medium"
        style={{ width: '100%' }}
      >
        {loading ? '入队中…' : '🤖 执行 Agent 任务'}
      </button>
      {msg && (
        <div
          style={{
            marginTop: 8,
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

export default AgentTaskRunButton
