/**
 * 独立 worker 进程：每秒消费一次队列。
 * 生产推荐：pm2 / systemd / docker compose 起一个常驻进程跑这个脚本。
 */
import 'dotenv/config'
import config from '../src/payload.config'
import { getPayload } from 'payload'

async function main() {
  const payload = await getPayload({ config })
  console.log('[worker] started, polling every 1s...')
  let stopped = false
  const stop = () => {
    stopped = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (!stopped) {
    try {
      const r = await payload.jobs.run({ limit: 5 })
      const total = (r as { jobStatus?: Record<string, unknown> }).jobStatus
        ? Object.keys((r as { jobStatus: Record<string, unknown> }).jobStatus).length
        : 0
      if (total > 0) console.log('[worker] processed', total)
    } catch (e) {
      console.error('[worker] error:', e)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
