import config from '@payload-config'
import { RootPage, generatePageMetadata } from '@payloadcms/next/views'

export const generateMetadata = ({ params, searchParams }: any) =>
  generatePageMetadata({ config, params, searchParams })

export default RootPage({ config })
