'use client'
import { useAllFormFields, useDocumentInfo } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * AI Model 详情页 "测试连接" 按钮
 * 读取当前表单值，POST /api/ai-models/test-connection
 */
const AiModelTestButton: React.FC = () => {
  const { id } = useDocumentInfo()
  const [fields] = useAllFormFields()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message?: string
    error?: string
    reply?: string
    latencyMs?: number
    sample?: number[]
    totalTokens?: number
  } | null>(null)

  const onClick = async () => {
    setLoading(true)
    setResult(null)
    try {
      const v = (k: string): unknown =>
        (fields as Record<string, { value?: unknown } | undefined>)[k]?.value
      const body = {
        id: id ? String(id) : undefined,
        provider: v('provider') as string | undefined,
        modelId: v('modelId') as string | undefined,
        baseUrl: v('baseUrl') as string | undefined,
        apiKey: v('apiKey') as string | undefined,
        modelType: v('modelType') as 'text' | 'embedding' | 'image' | 'video' | undefined,
        temperature: v('temperature') as number | undefined,
        maxTokens: v('maxTokens') as number | undefined,
      }
      const res = await fetch('/api/ai-models/test-connection', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setResult({ success: false, error: (e as Error).message })
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
        className="btn btn--style-secondary btn--size-medium"
        style={{ width: '100%' }}
      >
        {loading ? '测试中…' : '🔌 测试连接（发送 "你好"）'}
      </button>
      {result && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: result.success ? 'rgba(46,160,67,.08)' : 'rgba(248,81,73,.08)',
            border: `1px solid ${result.success ? 'rgba(46,160,67,.4)' : 'rgba(248,81,73,.4)'}`,
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, color: result.success ? '#2ea043' : '#f85149' }}>
            {result.success ? result.message || '✓ 成功' : `✗ ${result.error}`}
          </div>
          {typeof result.latencyMs === 'number' && (
            <div style={{ color: 'var(--theme-text-color, inherit)', opacity: 0.7 }}>
              耗时 {result.latencyMs} ms
              {typeof result.totalTokens === 'number' && ` · ${result.totalTokens} tokens`}
            </div>
          )}
          {result.reply && (
            <div style={{ marginTop: 6, padding: 6, background: 'rgba(0,0,0,.2)', borderRadius: 3 }}>
              <strong>模型回复：</strong>
              <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{result.reply}</div>
            </div>
          )}
          {result.sample && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, opacity: 0.8 }}>
              向量前 4 维：[{result.sample.join(', ')}, …]
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AiModelTestButton
