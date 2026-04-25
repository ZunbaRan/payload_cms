'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'

export function ReportCharts({
  days,
  statusDist,
  topTags,
}: {
  days: { date: string; notes: number; tasks: number }[]
  statusDist: { name: string; value: number; color: string }[]
  topTags: { name: string; count: number }[]
}) {
  return (
    <div className="charts">
      <div className="chart">
        <h3>📈 最近 14 天 · 每日创建量</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={days}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
            <Legend />
            <Line type="monotone" dataKey="notes" name="笔记" stroke="#6366f1" strokeWidth={2} />
            <Line type="monotone" dataKey="tasks" name="任务" stroke="#10b981" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart">
        <h3>🥧 任务状态分布</h3>
        {statusDist.length === 0 ? (
          <div className="empty">暂无任务数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={statusDist}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {statusDist.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="chart chart--wide">
        <h3>🏷️ 标签频次 Top 10</h3>
        {topTags.length === 0 ? (
          <div className="empty">暂无标签数据 — 创建笔记后 AI 会自动打标签</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topTags} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
              <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={12} width={80} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
              <Bar dataKey="count" name="笔记数" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
