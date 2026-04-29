'use client'
import { SelectInput, useAllFormFields, useField } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

type FieldMeta = { path: string; type: string; label?: string }

/**
 * 在 AgentTask "输入变量" 数组的每行里出现的"目标字段"下拉。
 *
 * 工作流程：
 * 1. 通过 useAllFormFields 读取 AgentTask 表单根节点的 boundCollection 值
 * 2. fetch /api/agent-tasks-introspect?collection=<slug> 拿到该集合的字段列表
 * 3. 渲染下拉，选中后写到自己 row 的 fieldPath
 *
 * 当 boundCollection 未填时，提示用户先选集合。
 */
const FieldPathSelectField: React.FC<{
  path: string
  field: { label?: string; admin?: { description?: string } }
}> = ({ path, field }) => {
  const { value, setValue } = useField<string>({ path })
  const [allFields] = useAllFormFields()
  const boundCollection = (allFields?.['boundCollection']?.value as string | undefined) || ''

  const [fields, setFields] = useState<FieldMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!boundCollection) {
      setFields([])
      return
    }
    let mounted = true
    setLoading(true)
    setError(null)
    fetch(`/api/agent-tasks-introspect?collection=${encodeURIComponent(boundCollection)}`, {
      credentials: 'include',
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data?.error || r.statusText)
        const c = (data.collections || [])[0]
        if (mounted) setFields(c?.fields || [])
      })
      .catch((e) => mounted && setError((e as Error).message))
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [boundCollection])

  const options = useMemo(
    () => [
      { label: '— 不映射 —', value: '' },
      ...fields.map((f) => ({
        label: `${f.label || f.path}  (${f.type})  ${f.path}`,
        value: f.path,
      })),
    ],
    [fields],
  )

  return (
    <div className="field-type" style={{ marginBottom: 12 }}>
      <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
        {(field?.label as string) || '目标字段'}
      </label>
      {!boundCollection ? (
        <div style={{ fontSize: 12, color: '#888', padding: '6px 0' }}>
          请先在上方选择"绑定集合"，然后这里会列出该集合的字段。
        </div>
      ) : (
        <>
          <SelectInput
            path={path}
            name={path}
            options={options}
            value={value || ''}
            onChange={(opt) => {
              const next =
                opt && typeof opt === 'object' && 'value' in opt
                  ? (opt as { value: string }).value
                  : ''
              setValue(next || null)
            }}
          />
          {loading && <div style={{ fontSize: 12, color: '#888' }}>加载字段…</div>}
          {error && <div style={{ fontSize: 12, color: 'crimson' }}>{error}</div>}
        </>
      )}
      {field?.admin?.description && (
        <div style={{ fontSize: 12, color: 'var(--theme-text-light, #888)', marginTop: 4 }}>
          {field.admin.description}
        </div>
      )}
    </div>
  )
}

export default FieldPathSelectField
