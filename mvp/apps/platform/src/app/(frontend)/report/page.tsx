import { getPayload } from 'payload'
import config from '@/payload.config'
import Link from 'next/link'
import { ReportCharts } from './ReportCharts'
import './report.css'

export const dynamic = 'force-dynamic'

export default async function ReportPage() {
  const payload = await getPayload({ config: await config })

  // 拉全量（MVP 阶段数据少无所谓；真实场景要做聚合）
  const allNotes = await payload.find({ collection: 'notes', limit: 1000, sort: '-createdAt' })
  const allTasks = await payload.find({ collection: 'tasks', limit: 1000, sort: '-createdAt' })

  // 1) 按天统计最近 14 天的笔记创建量
  const days: { date: string; notes: number; tasks: number }[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(5, 10) // MM-DD
    days.push({ date: key, notes: 0, tasks: 0 })
  }
  const dayIndex = (isoDate: string) => isoDate.slice(5, 10)
  for (const n of allNotes.docs as any[]) {
    const k = dayIndex(n.createdAt)
    const slot = days.find((x) => x.date === k)
    if (slot) slot.notes++
  }
  for (const t of allTasks.docs as any[]) {
    const k = dayIndex(t.createdAt)
    const slot = days.find((x) => x.date === k)
    if (slot) slot.tasks++
  }

  // 2) 任务状态分布
  const statusDist = [
    { name: '待办', value: allTasks.docs.filter((t: any) => t.status === 'todo').length, color: '#64748b' },
    { name: '进行中', value: allTasks.docs.filter((t: any) => t.status === 'in_progress').length, color: '#3b82f6' },
    { name: '已完成', value: allTasks.docs.filter((t: any) => t.status === 'done').length, color: '#10b981' },
    { name: '已取消', value: allTasks.docs.filter((t: any) => t.status === 'cancelled').length, color: '#94a3b8' },
  ].filter((s) => s.value > 0)

  // 3) 标签频次 Top 10
  const tagFreq = new Map<string, number>()
  for (const n of allNotes.docs as any[]) {
    for (const tag of n.tags || []) {
      tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1)
    }
  }
  const topTags = Array.from(tagFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // 4) 任务完成率
  const totalTasks = allTasks.totalDocs
  const completedTasks = allTasks.docs.filter((t: any) => t.status === 'done').length
  const completionRate = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100)

  return (
    <div className="report">
      <header>
        <div>
          <h1>数据报表</h1>
          <p>基于 Payload Local API 聚合 · Recharts 可视化</p>
        </div>
        <nav>
          <Link href="/admin">Admin</Link>
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </header>

      <section className="kpis">
        <KPI label="笔记总数" value={allNotes.totalDocs} />
        <KPI label="任务总数" value={totalTasks} />
        <KPI label="完成率" value={`${completionRate}%`} />
        <KPI label="标签种类" value={tagFreq.size} />
      </section>

      <ReportCharts days={days} statusDist={statusDist} topTags={topTags} />
    </div>
  )
}

function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="kpi">
      <div className="kpi__value">{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}
