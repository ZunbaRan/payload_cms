import { RootLayout } from '@payloadcms/next/layouts'
import React from 'react'
import { importMap } from '../../importMap'
import config from '@payload-config'

export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap}>
      {children}
    </RootLayout>
  )
}
