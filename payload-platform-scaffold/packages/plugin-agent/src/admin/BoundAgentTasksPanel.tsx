'use client'
import { useAllFormFields, useDocumentInfo, useForm } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

type AgentTaskDoc = {
  id: number | string
  name: string
  slug?: string
  boundCollection?: string
  targetFieldPath?: string | null
  variables?: Array<{ key?: string; fieldPath?: string | null; defaultValue?: string | null }>
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyFieldValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const r = value as Record<string, unknown>
    // Lexical richText: { root: { children: [...] } }
    if (r.root && typeof r.root === 'object') {
      try {
        return extractLexicalText(r.root as LexicalNode).trim()
      } catch {
        // fallthrough
      }
    }
    const primary = r.title || r.name || r.label || r.id
    if (primary != null) return stringifyFieldValue(primary)
  }
  return JSON.stringify(value)
}

type LexicalNode = {
  text?: string
  type?: string
  children?: LexicalNode[]
}
function extractLexicalText(node: LexicalNode): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.children)) {
    const parts = node.children.map(extractLexicalText)
    const block = ['paragraph', 'heading', 'listitem', 'quote'].includes(node.type || '')
    return parts.join('') + (block ? '\n' : '')
  }
  return ''
}

async function pollRun(
  runId: string | number,
  intervalMs: number,
  timeoutMs: number,
): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/agent-task-runs/${runId}?depth=0`, {
      credentials: 'include',
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || res.statusText)
    if (data.status === 'success') return data.finalOutput || ''
    if (data.status === 'failed') throw new Error(data.errorMessage || 'Agent task failed')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Agent task polling timed out')
}

/**
 * 自动注入到所有业务集合编辑页 (beforeDocumentControls) 的通用面板。
 *
 * 工作流程：
 * 1. 从 useDocumentInfo 拿到当前 collectionSlug 和 doc id
 * 2. 拉 /api/agent-tasks?where[boundCollection][equals]=<slug> 找绑定的任务
 * 3. 每个任务渲染一个按钮，点击时按 task.variables[].fieldPath 从当前表单抽值
 *    组装成 inputs，POST /api/agent-tasks/:slug/run
 * 4. 轮询 agent-task-runs，成功后：
 *    - 若任务设了 targetFieldPath：用 dispatchFields UPDATE 自动回写
 *    - 否则：浮出结果让用户复制
 */
const BoundAgentTasksPanel: React.FC = () => {
  const { id: docId, collectionSlug } = useDocumentInfo()
  const [fields, dispatchFields] = useAllFormFields()
  // useForm 的 setModified 是唯一能摆亮顶部 Save 按钮的接口（UPDATE action 不会自动 mark dirty）
  const { setModified } = useForm()

  const [tasks, setTasks] = useState<AgentTaskDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [runState, setRunState] = useState<
    Record<string, { running?: boolean; message?: string; output?: string; ok?: boolean }>
  >({})

  // 不要在 agent-tasks / agent-task-runs / agent-skills 自身上显示
  const skip =
    !collectionSlug ||
    ['agent-tasks', 'agent-task-runs', 'agent-skills', 'users', 'payload-preferences'].includes(
      collectionSlug,
    )

  useEffect(() => {
    if (skip) return
    let mounted = true
    setLoading(true)
    fetch(
      `/api/agent-tasks?where[boundCollection][equals]=${encodeURIComponent(
        collectionSlug,
      )}&limit=50&depth=0`,
      { credentials: 'include' },
    )
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data?.error || r.statusText)
        if (mounted) setTasks(data.docs || [])
      })
      .catch(() => mounted && setTasks([]))
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [collectionSlug, skip])

  const visibleTasks = useMemo(() => tasks.filter((t) => t.boundCollection === collectionSlug), [
    tasks,
    collectionSlug,
  ])

  if (skip) return null
  if (loading) return null
  if (visibleTasks.length === 0) return null

  const runTask = async (task: AgentTaskDoc) => {
    const key = String(task.id)
    setRunState((s) => ({ ...s, [key]: { running: true, message: '入队中…' } }))
    try {
      // 组装 inputs：每个 variable 看 fieldPath，从当前表单读
      const inputs: Record<string, string> = {}
      for (const v of task.variables || []) {
        if (!v?.key) continue
        if (v.fieldPath) {
          inputs[v.key] = stringifyFieldValue(fields[v.fieldPath]?.value)
        } else if (v.defaultValue) {
          inputs[v.key] = v.defaultValue
        }
      }

      const callId = task.slug || task.id
      const res = await fetch(`/api/agent-tasks/${encodeURIComponent(String(callId))}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || res.statusText)

      setRunState((s) => ({ ...s, [key]: { running: true, message: '运行中…' } }))
      const output = await pollRun(data.agentTaskRunId, 1500, 180000)

      if (task.targetFieldPath) {
        dispatchFields({ type: 'UPDATE', path: task.targetFieldPath, value: output })
        // 强制 mark dirty 让顶部 Save 按钮亮起
        setModified?.(true)
        setRunState((s) => ({
          ...s,
          [key]: { ok: true, message: `✓ 已写入 ${task.targetFieldPath}（请点 Save 保存）` },
        }))
      } else {
        setRunState((s) => ({
          ...s,
          [key]: { ok: true, message: '✓ 完成', output },
        }))
      }
    } catch (e) {
      setRunState((s) => ({ ...s, [key]: { ok: false, message: `✗ ${(e as Error).message}` } }))
    }
  }

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 8,
        padding: 8,
        border: '1px solid var(--theme-border-color, #ddd)',
        borderRadius: 4,
        background: 'var(--theme-elevation-50, #fafafa)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>
        🤖 AI 任务（绑定到 {collectionSlug}）
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {visibleTasks.map((task) => {
          const key = String(task.id)
          const st = runState[key] || {}
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: 8,
                border: '1px solid var(--theme-border-color, #eee)',
                borderRadius: 4,
                minWidth: 200,
                background: 'var(--theme-bg, #fff)',
              }}
            >
              <button
                type="button"
                className="btn btn--style-secondary btn--size-small"
                disabled={st.running}
                onClick={() => runTask(task)}
              >
                {st.running ? '运行中…' : `▶ ${task.name}`}
              </button>
              {task.targetFieldPath && (
                <div style={{ fontSize: 11, color: '#888' }}>→ 写入 {task.targetFieldPath}</div>
              )}
              {st.message && (
                <div
                  style={{
                    fontSize: 11,
                    color:
                      st.ok === undefined ? '#888' : st.ok ? 'green' : 'crimson',
                    wordBreak: 'break-word',
                  }}
                >
                  {st.message}
                </div>
              )}
              {st.output && (
                <textarea
                  readOnly
                  value={st.output}
                  style={{
                    width: '100%',
                    fontSize: 12,
                    minHeight: 80,
                    padding: 4,
                    border: '1px solid #ddd',
                    borderRadius: 2,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      {!docId && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
          提示：保存草稿后再点击，运行时会读取你当前在表单里输入的内容。
        </div>
      )}
    </div>
  )
}

export default BoundAgentTasksPanel
