import { RootPage, generatePageMetadata } from '@payloadcms/next/views'
import { importMap } from '../importMap'

export const generateMetadata = generatePageMetadata

export default function Page(args: any) {
  return RootPage({ ...args, importMap })
}
