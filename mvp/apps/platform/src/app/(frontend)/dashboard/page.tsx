import { getPayload } from 'payload'
import config from '@/payload.config'
import Link from 'next/link'
import './dashboard.css'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const payload = await getPayload({ config: await config })

  const [notes, tasks, importantNotes, docs] = await Promise.all([
    payload.find({ collection: 'notes', limit: 5, sort: '-updatedAt' }),
    payload.find({
      collection: 'tasks',
      limit: 10,
      where: { status: { not_equals: 'done' } },
      sort: 'dueDate',
    }),
    payload.find({
      collection: 'notes',
      limit: 5,
      where: { isImportant: { equals: true } },
      sort: '-updatedAt',
    }),
    payload.find({ collection: 'documents', limit: 5, sort: '-createdAt' }),
  ])

  const todoCount = await payload.count({
    collection: 'tasks',
    where: { status: { equals: 'todo' } },
  })
  const inProgressCount = await payload.count({
    collection: 'tasks',
    where: { status: { equals: 'in_progress' } },
  })
  const doneCount = await payload.count({
    collection: 'tasks',
    where: { status: { equals: 'done' } },
  })

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div>
          <h1>个人 Dashboard</h1>
          <p>Local API 直连 Payload · 数据实时</p>
        </div>
        <nav>
          <Link href="/admin">Admin</Link>
          <Link href="/report">Report</Link>
        </nav>
      </header>

      <section className="stats">
        <Stat label="笔记总数" value={notes.totalDocs} color="#6366f1" />
        <Stat label="重要笔记" value={importantNotes.totalDocs} color="#f97316" />
        <Stat label="待办任务" value={todoCount.totalDocs} color="#64748b" />
        <Stat label="进行中" value={inProgressCount.totalDocs} color="#3b82f6" />
        <Stat label="已完成" value={doneCount.totalDocs} color="#10b981" />
        <Stat label="上传文档" value={docs.totalDocs} color="#a855f7" />
      </section>

      <div className="grid">
        <Panel title="📝 最近笔记">
          {notes.docs.length === 0 && <Empty />}
          {notes.docs.map((n: any) => (
            <div className="row" key={n.id}>
              <div className="row__title">
                <a href={`/admin/collections/notes/${n.id}`} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
                {n.isImportant && <span className="badge badge--orange">重要</span>}
              </div>
              <div className="row__meta">
                {(n.tags || []).slice(0, 5).map((t: string) => (
                  <span key={t} className="tag">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="🔥 重要笔记">
          {importantNotes.docs.length === 0 && <Empty />}
          {importantNotes.docs.map((n: any) => (
            <div className="row" key={n.id}>
              <div className="row__title">
                <a href={`/admin/collections/notes/${n.id}`} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
              </div>
              <div className="row__meta subtle">
                {n.importanceReason || '(无理由)'}
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="✅ 未完成任务">
          {tasks.docs.length === 0 && <Empty />}
          {tasks.docs.map((t: any) => (
            <div className="row" key={t.id}>
              <div className="row__title">
                <a href={`/admin/collections/tasks/${t.id}`} target="_blank" rel="noreferrer">
                  {t.title}
                </a>
                <span className={`badge badge--${t.priority}`}>{t.priority || 'medium'}</span>
                <span className={`badge badge--status-${t.status}`}>{t.status}</span>
              </div>
              {t.dueDate && (
                <div className="row__meta subtle">
                  截止：{new Date(t.dueDate).toLocaleDateString('zh-CN')}
                </div>
              )}
            </div>
          ))}
        </Panel>

        <Panel title="📄 最近上传文档">
          {docs.docs.length === 0 && <Empty />}
          {docs.docs.map((d: any) => (
            <div className="row" key={d.id}>
              <div className="row__title">
                <a href={`/admin/collections/documents/${d.id}`} target="_blank" rel="noreferrer">
                  {d.filename}
                </a>
                <span className={`badge badge--status-${d.status}`}>{d.status}</span>
              </div>
              {d.summary && (
                <div className="row__meta subtle">{String(d.summary).slice(0, 80)}...</div>
              )}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat">
      <div className="stat__value" style={{ color }}>{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h2 className="panel__title">{title}</h2>
      <div className="panel__body">{children}</div>
    </div>
  )
}

function Empty() {
  return <div className="empty">暂无数据</div>
}
