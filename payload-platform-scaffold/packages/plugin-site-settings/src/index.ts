import type { Config, Plugin } from 'payload'
import { SiteSettings } from './globals/SiteSettings'

export interface SiteSettingsPluginOptions {
  enabled?: boolean
}

export const siteSettingsPlugin =
  (options: SiteSettingsPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      globals: [...(incomingConfig.globals || []), SiteSettings],
    }
  }

export { SiteSettings }
