import type { Config, Plugin } from 'payload'
import { ArticleReviews } from './collections/ArticleReviews'
import { Articles } from './collections/Articles'
import { Categories } from './collections/Categories'

export interface ContentPluginOptions {
  enabled?: boolean
}

export const contentPlugin =
  (options: ContentPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        Categories,
        Articles,
        ArticleReviews,
      ],
    }
  }

export { ArticleReviews, Articles, Categories }
