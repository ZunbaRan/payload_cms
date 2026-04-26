import { JOBS_REST_HANDLER } from '@payloadcms/next/routes'
import config from '@payload-config'

export const GET = JOBS_REST_HANDLER(config)
export const POST = JOBS_REST_HANDLER(config)
