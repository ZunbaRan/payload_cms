import config from '@payload-config'
import '@payloadcms/next/css'
import { RootLayout } from '@payloadcms/next/layouts'
import type { ReactNode } from 'react'

export default async function Layout({ children }: { children: ReactNode }) {
  return <RootLayout config={config}>{children}</RootLayout>
}
