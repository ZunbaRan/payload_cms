'use client'

import { useAllFormFields } from '@payloadcms/ui'
import React, { useMemo, useState } from 'react'

type InputMapping = {
  key: string
  fieldPath?: string
  value?: string
}

type AiTaskFieldButtonConfig = {
  agentTaskId: string | number
  targetPath: string
  label?: string
  inputMappings?: InputMapping[]
  applyMode?: 'replace' | 'append'
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

type Props = {
  aiTask?: AiTaskFieldButtonConfig
  clientField?: {
    custom?: {
      aiTask?: AiTaskFieldButtonConfig
    }
  }
  field?: {
    custom?: {
      aiTask?: AiTaskFieldButtonConfig
    }
  }
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyFieldValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const primary = record.title || record.name || record.label || record.id
    if (primary != null) return stringifyFieldValue(primary)
  }
  return JSON.stringify(value)
}

async function pollRun(runId: string | number, intervalMs: number, timeoutMs: number): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/agent-task-runs/${runId}?depth=0`, {
      credentials: 'include',
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || res.statusText)
    if (data.status === 'success') return data.finalOutput || ''
    if (data.status === 'failed') throw new Error(data.errorMessage || 'Agent task failed')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Agent task polling timed out')
}

const AiTaskFieldButton: React.FC<Props> = ({ aiTask, clientField, field }) => {
  const config = aiTask || clientField?.custom?.aiTask || field?.custom?.aiTask
  const [fields, dispatchFields] = useAllFormFields()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const inputs = useMemo(() => {
    const next: Record<string, string> = {}
    for (const mapping of config?.inputMappings || []) {
      if (!mapping.key) continue
      if (mapping.value != null) {
        next[mapping.key] = mapping.value
        continue
      }
      if (mapping.fieldPath) {
        next[mapping.key] = stringifyFieldValue(fields[mapping.fieldPath]?.value)
      }
    }
    return next
  }, [config?.inputMappings, fields])

  if (!config?.agentTaskId || !config.targetPath) {
    return (
      <div style={{ marginTop: 8, marginBottom: 16, color: 'crimson', fontSize: 12 }}>
        AI Task field missing aiTask config
      </div>
    )
  }

  const run = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/agent-tasks/${config.agentTaskId}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || res.statusText)

      const output = await pollRun(
        data.agentTaskRunId,
        config.pollIntervalMs || 1500,
        config.pollTimeoutMs || 120000,
      )

      const currentValue = stringifyFieldValue(fields[config.targetPath]?.value)
      const value = config.applyMode === 'append' && currentValue
        ? `${currentValue}\n\n${output}`
        : output

      dispatchFields({
        type: 'UPDATE',
        path: config.targetPath,
        value,
      })
      setMessage(`已写入 ${config.targetPath}`)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <button
        type="button"
        className="btn btn--style-secondary btn--size-small"
        disabled={loading}
        onClick={run}
      >
        {loading ? '生成中...' : config.label || 'AI 生成'}
      </button>
      {message && (
        <span style={{ fontSize: 12, color: message.startsWith('已写入') ? 'green' : 'crimson' }}>
          {message}
        </span>
      )}
    </div>
  )
}

export default AiTaskFieldButton
