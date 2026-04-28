import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 让 Turbopack 把仓库根锁定在 monorepo，避免误用上层 lockfile
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  // 这些包包含 native binding / 大型可选依赖，禁止打包，留给 Node runtime 直接 require
  serverExternalPackages: [
    '@xenova/transformers',
    'onnxruntime-node',
    'sharp',
    '@payloadcms/db-postgres',
    'pg',
    'pg-native',
  ],
}

export default withPayload(nextConfig)
