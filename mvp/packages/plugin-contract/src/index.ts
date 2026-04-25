import type { Config, Plugin } from 'payload'
import { Contracts } from './collections/Contracts'

export interface ContractPluginOptions {
  /** 是否启用该插件（用于临时关闭但保留数据库表结构） */
  enabled?: boolean
}

/**
 * Contract Plugin
 *
 * 一个 Payload Plugin 就是：
 *   (options) => (incomingConfig: Config) => Config
 *
 * 本 Plugin 的职责：向 Payload 注入 `contracts` Collection。
 * 对应的 MCP Tools 从 '@mvp/plugin-contract/mcp' 单独导出，
 * 由平台侧注册到 mcpPlugin 的 mcp.tools 数组中。
 */
export const contractPlugin =
  (options: ContractPluginOptions = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (options.enabled === false) {
      return incomingConfig
    }

    return {
      ...incomingConfig,
      collections: [...(incomingConfig.collections || []), Contracts],
    }
  }

export { Contracts }
export { contractMcpTools } from './mcp/tools'
