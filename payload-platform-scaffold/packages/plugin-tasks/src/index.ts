import type { Config, Plugin } from 'payload'
import { TaskRuns } from './collections/TaskRuns'
import { TaskSchedules } from './collections/TaskSchedules'
import { Tasks } from './collections/Tasks'
import { WorkerHeartbeats } from './collections/WorkerHeartbeats'
import { processTaskRun } from './jobs/processTaskRun'

export interface TasksPluginOptions {
  enabled?: boolean
}

export const tasksPlugin =
  (options: TasksPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        Tasks,
        TaskRuns,
        TaskSchedules,
        WorkerHeartbeats,
      ],
      jobs: {
        ...(incomingConfig.jobs || {}),
        tasks: [...(incomingConfig.jobs?.tasks || []), processTaskRun],
      },
    }
  }

export { processTaskRun }
export { TaskRuns, TaskSchedules, Tasks, WorkerHeartbeats }
