import type { Endpoint, PayloadRequest, Field } from 'payload'

/**
 * GET /api/agent-tasks-introspect
 * GET /api/agent-tasks-introspect?collection=articles
 *
 * 返回 Payload 当前所有 collection 的元信息（slug + label + fields），
 * 供 Agent Task 配置页里"绑定集合 / 选字段"下拉使用。
 *
 * 不返回字段值，只返回 schema。任何登录用户都能调用。
 */

const READABLE_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'code',
  'json',
  'richText',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
  'relationship',
  'upload',
  'point',
])

/**
 * 递归展开 group / tabs / row / collapsible 这类容器字段，
 * 把里面真正的"叶子字段"打平输出。
 * fieldPath 用 dot 表示 group 嵌套，对应 useAllFormFields 的 path。
 */
function flattenFields(fields: Field[], prefix = ''): Array<{
  path: string
  type: string
  label?: string
  required?: boolean
}> {
  const out: Array<{ path: string; type: string; label?: string; required?: boolean }> = []

  for (const f of fields || []) {
    if (!f) continue
    const type = (f as { type: string }).type

    // 容器：tabs
    if (type === 'tabs') {
      const tabs = (f as { tabs?: Array<{ name?: string; fields: Field[] }> }).tabs || []
      for (const t of tabs) {
        const childPrefix = t.name ? (prefix ? `${prefix}.${t.name}` : t.name) : prefix
        out.push(...flattenFields(t.fields, childPrefix))
      }
      continue
    }

    // 容器：row / collapsible（无 name，扁平继承 prefix）
    if (type === 'row' || type === 'collapsible') {
      const inner = (f as { fields?: Field[] }).fields || []
      out.push(...flattenFields(inner, prefix))
      continue
    }

    const named = f as { name?: string; label?: unknown; required?: boolean; fields?: Field[] }
    if (!named.name) continue
    const path = prefix ? `${prefix}.${named.name}` : named.name

    // 容器：group（带 name，作为前缀继续展开）
    if (type === 'group') {
      out.push(...flattenFields(named.fields || [], path))
      continue
    }

    // array / blocks 不展开（每行一个独立子表单），把整体作为一个字段抛出，UI 端按需处理
    const labelStr =
      typeof named.label === 'string'
        ? named.label
        : typeof named.label === 'object' && named.label
          ? Object.values(named.label as Record<string, string>)[0]
          : undefined

    out.push({
      path,
      type,
      label: labelStr,
      required: named.required,
    })
  }

  return out
}

export const introspectCollectionsEndpoint: Endpoint = {
  path: '/agent-tasks-introspect',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const wantedSlug = (req.query?.collection as string | undefined) || undefined
    const all = req.payload.config.collections || []

    // 默认排除一些纯系统/审计类集合，避免下拉太长
    const HIDDEN = new Set([
      'payload-preferences',
      'payload-migrations',
      'payload-jobs',
      'payload-locked-documents',
      'agent-task-runs',
    ])

    const collections = all
      .filter((c) => !HIDDEN.has(c.slug))
      .filter((c) => (wantedSlug ? c.slug === wantedSlug : true))
      .map((c) => {
        const labelObj = c.labels?.singular
        const label =
          typeof labelObj === 'string'
            ? labelObj
            : typeof labelObj === 'object' && labelObj
              ? Object.values(labelObj as Record<string, string>)[0]
              : c.slug

        const fields = flattenFields(c.fields || []).filter((f) =>
          READABLE_FIELD_TYPES.has(f.type),
        )
        return { slug: c.slug, label, fields }
      })

    return Response.json({ collections })
  },
}
