import type { Config, Plugin } from 'payload'
import { UrlImportJobLogs } from './collections/UrlImportJobLogs'
import { UrlImportJobs } from './collections/UrlImportJobs'

export interface UrlImportPluginOptions {
  enabled?: boolean
}

export const urlImportPlugin =
  (options: UrlImportPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        UrlImportJobs,
        UrlImportJobLogs,
      ],
    }
  }

export { UrlImportJobLogs, UrlImportJobs }
