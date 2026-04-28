'use client'
import { useDocumentInfo } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * 在 Tasks 详情页右侧栏渲染一个 "Run Now" 按钮。
 * 调用 POST /api/tasks/:id/run 入队 processTaskRun。
 */
const TaskRunNowButton: React.FC = () => {
  const { id } = useDocumentInfo()
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!id) {
    return null
  }

  const onClick = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/tasks/${id}/run`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(`✗ ${data.error || res.statusText}`)
      } else {
        setMsg(`✓ queued (jobId: ${data.jobId}, runId: ${data.taskRunId})`)
      }
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 12, border: '1px solid var(--theme-border-color)', borderRadius: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="btn btn--style-primary btn--size-medium"
        style={{ width: '100%' }}
      >
        {loading ? '入队中…' : '▶ 立即运行'}
      </button>
      {msg && (
        <div style={{ marginTop: 8, fontSize: 12, color: msg.startsWith('✓') ? 'green' : 'crimson' }}>
          {msg}
        </div>
      )}
    </div>
  )
}

export default TaskRunNowButton
