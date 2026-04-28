import type { Config, Plugin } from 'payload'

import { Authors } from './collections/Authors'
import { ImageLibraries } from './collections/ImageLibraries'
import { Images } from './collections/Images'
import { KeywordLibraries } from './collections/KeywordLibraries'
import { Keywords } from './collections/Keywords'
import { TitleLibraries } from './collections/TitleLibraries'
import { Titles } from './collections/Titles'

export interface MaterialsPluginOptions {
  enabled?: boolean
}

export const materialsPlugin =
  (options: MaterialsPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig
    return {
      ...incomingConfig,
      collections: [
        ...(incomingConfig.collections || []),
        Authors,
        TitleLibraries,
        Titles,
        KeywordLibraries,
        Keywords,
        ImageLibraries,
        Images,
      ],
    }
  }

export {
  Authors,
  ImageLibraries,
  Images,
  KeywordLibraries,
  Keywords,
  TitleLibraries,
  Titles,
}
