import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * 插入到 admin 首页顶部的欢迎 + 统计组件（Server Component）
 */
export default async function BeforeDashboard() {
  const payload = await getPayload({ config })
  const [notes, importantNotes, tasks, doneTasks, docs] = await Promise.all([
    payload.count({ collection: 'notes', overrideAccess: true }),
    payload.count({ collection: 'notes', where: { isImportant: { equals: true } }, overrideAccess: true }),
    payload.count({ collection: 'tasks', overrideAccess: true }),
    payload.count({ collection: 'tasks', where: { status: { equals: 'done' } }, overrideAccess: true }),
    payload.count({ collection: 'documents', overrideAccess: true }),
  ])

  const cardStyle: React.CSSProperties = {
    background: 'var(--theme-elevation-100)',
    border: '1px solid var(--theme-elevation-200)',
    borderRadius: 6,
    padding: '16px 20px',
    flex: '1 1 160px',
    minWidth: 140,
  }
  const valueStyle: React.CSSProperties = { fontSize: 26, fontWeight: 700, lineHeight: 1.2 }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--theme-elevation-500)' }

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ marginTop: 0, marginBottom: 12 }}>欢迎回到 MVP Platform 👋</h2>
      <p style={{ color: 'var(--theme-elevation-500)', marginTop: 0 }}>
        AI + Payload + Next.js 学习项目 ·{' '}
        <Link href="/dashboard">前台 Dashboard</Link> ·{' '}
        <Link href="/report">数据报表</Link>
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <div style={cardStyle}>
          <div style={valueStyle}>{notes.totalDocs}</div>
          <div style={labelStyle}>笔记</div>
        </div>
        <div style={cardStyle}>
          <div style={{ ...valueStyle, color: '#f97316' }}>{importantNotes.totalDocs}</div>
          <div style={labelStyle}>重要笔记</div>
        </div>
        <div style={cardStyle}>
          <div style={valueStyle}>{tasks.totalDocs}</div>
          <div style={labelStyle}>任务</div>
        </div>
        <div style={cardStyle}>
          <div style={{ ...valueStyle, color: '#10b981' }}>{doneTasks.totalDocs}</div>
          <div style={labelStyle}>已完成</div>
        </div>
        <div style={cardStyle}>
          <div style={{ ...valueStyle, color: '#a855f7' }}>{docs.totalDocs}</div>
          <div style={labelStyle}>文档</div>
        </div>
      </div>
    </div>
  )
}
