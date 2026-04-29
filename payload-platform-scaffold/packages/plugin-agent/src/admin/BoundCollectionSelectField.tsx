'use client'
import { SelectInput, useField } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

type CollectionMeta = {
  slug: string
  label: string
}

/**
 * Agent Task: "绑定到集合" 下拉。
 * 调用 /api/agent-tasks-introspect 获取 collection 列表。
 * 选中后会触发同表单内 FieldPathSelectField 重新加载该集合的字段。
 */
const BoundCollectionSelectField: React.FC<{
  path: string
  field: { label?: string; admin?: { description?: string } }
}> = ({ path, field }) => {
  const { value, setValue } = useField<string>({ path })
  const [collections, setCollections] = useState<CollectionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/agent-tasks-introspect', { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data?.error || r.statusText)
        if (mounted) setCollections(data.collections || [])
      })
      .catch((e) => mounted && setError((e as Error).message))
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [])

  const options = useMemo(
    () => [
      { label: '— 不绑定（仅手动调用）—', value: '' },
      ...collections.map((c) => ({
        label: `${c.label}  (${c.slug})`,
        value: c.slug,
      })),
    ],
    [collections],
  )

  return (
    <div className="field-type" style={{ marginBottom: 16 }}>
      <label className="field-label" style={{ display: 'block', marginBottom: 4 }}>
        {(field?.label as string) || '绑定到集合'}
      </label>
      <SelectInput
        path={path}
        name={path}
        options={options}
        value={value || ''}
        onChange={(opt) => {
          const next =
            opt && typeof opt === 'object' && 'value' in opt ? (opt as { value: string }).value : ''
          setValue(next || null)
        }}
      />
      {field?.admin?.description && (
        <div style={{ fontSize: 12, color: 'var(--theme-text-light, #888)', marginTop: 4 }}>
          {field.admin.description}
        </div>
      )}
      {loading && <div style={{ fontSize: 12, color: '#888' }}>加载中…</div>}
      {error && <div style={{ fontSize: 12, color: 'crimson' }}>{error}</div>}
    </div>
  )
}

export default BoundCollectionSelectField
