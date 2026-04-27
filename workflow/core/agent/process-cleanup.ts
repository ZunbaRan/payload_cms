/**
 * @fileoverview Per-agent listening-process cleanup utilities.
 *
 * Pattern:
 *   const before = snapshotListeningPIDs()
 *   try { await agent.run(...) }
 *   finally { killNewPIDs(name, diffPIDs(before), log) }
 *
 * Only processes that appeared DURING an agent's run are killed.
 * Pre-existing listening processes are never touched.
 */

import { execSync } from 'node:child_process'

/**
 * Return the set of PIDs currently listening on any TCP port.
 *
 * Uses `lsof -nP -iTCP -sTCP:LISTEN`.
 * Returns an empty set when lsof is unavailable or fails (graceful degradation).
 */
export function snapshotListeningPIDs(): Set<number> {
  try {
    const output = execSync('lsof -nP -iTCP -sTCP:LISTEN', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5_000,
    })
    const pids = new Set<number>()
    // First line is the header — skip it.
    for (const line of output.split('\n').slice(1)) {
      const pid = parseInt(line.trim().split(/\s+/)[1] ?? '', 10)
      if (!isNaN(pid)) pids.add(pid)
    }
    return pids
  } catch {
    // lsof not available or timed out — degrade gracefully, no cleanup
    return new Set()
  }
}

/**
 * Attempt to terminate each PID in `newPIDs`, logging every step.
 *
 * @param agentName  Used as prefix in log messages.
 * @param newPIDs    PIDs that appeared during the agent run (diff result).
 * @param log        Pipeline log function (addLog).
 */
export function killNewPIDs(
  agentName: string,
  newPIDs: number[],
  log: (msg: string) => void,
): void {
  if (newPIDs.length === 0) return

  log(`[${agentName}] 🔌 cleanup: ${newPIDs.length} new listening PID(s) to kill: ${newPIDs.join(', ')}`)

  for (const pid of newPIDs) {
    try {
      // Use kill -0 first to confirm the process is still alive (avoids stale PIDs)
      execSync(`kill -0 ${pid}`, { stdio: 'pipe' })
      // Process is alive — send SIGTERM
      process.kill(pid, 'SIGTERM')
      log(`[${agentName}] 🔌 killed PID ${pid} (SIGTERM)`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      log(`[${agentName}] 🔌 kill PID ${pid} skipped/failed: ${detail}`)
    }
  }
}
