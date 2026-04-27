/**
 * @fileoverview Types for the Deep Research search phase.
 */

import type { ClaudeAgentOptions } from '../agent/claude-agent.js'

// ---------------------------------------------------------------------------
// Search Dimension
// ---------------------------------------------------------------------------

/**
 * 单个搜索维度定义。
 *
 * - 用户可以手动指定维度（兼容 course-creator 固定 4 维度）
 * - 也可以留空让 Planner 自动规划
 */
export interface SearchDimension {
  /** 维度唯一 ID，例如 "foundations", "frontier" */
  readonly id: string
  /** 维度标题 */
  readonly title: string
  /** Searcher Agent 的完整系统提示词 */
  readonly systemPrompt: string
  /** 要搜索的具体 prompt（会替换 [TOPIC] 占位符） */
  readonly searchPrompt?: string
}

// ---------------------------------------------------------------------------
// Seed URL
// ---------------------------------------------------------------------------

/**
 * 用户提供的种子 URL。
 *
 * 典型场景：GitHub awesome-xxx 列表、论文合集、资源汇总页。
 * 搜索阶段会递归抓取其中的链接。
 */
export interface SeedUrl {
  /** URL 地址 */
  readonly url: string
  /** 可选标签，用于归类 */
  readonly label?: string
  /** 最大递归深度（默认 1 = 只抓当前页 + 页内链接） */
  readonly maxDepth?: number
}

// ---------------------------------------------------------------------------
// Local Book
// ---------------------------------------------------------------------------

/**
 * 用户提供的本地书籍文件。
 *
 * 典型场景：已下载到本地的 PDF 教材、专著。
 * 搜索阶段会通过 pdf-to-md 转换并按章拆分。
 */
export interface LocalBook {
  /** PDF 文件绝对路径 */
  readonly filePath: string
  /** 可选：书名（自动从文件名推断） */
  readonly title?: string
  /** 可选：只处理指定章节（TOC entry 序号，从 1 开始） */
  readonly chapters?: number[]
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * 搜索阶段的工作区目录结构。
 *
 * ```
 * {workspaceDir}/
 * ├── .claude/
 * │   └── skills/          ← 搜索 Agent 使用的 skill 符号链接
 * ├── materials/            ← 保存的 Markdown 文件
 * │   ├── search/           ← Searcher 自动搜索保存的
 * │   └── seeds/            ← Seed URL 抓取保存的
 * ├── INDEX.md              ← 搜索完成后生成的目录索引
 * └── search-plan.json      ← Planner 输出的搜索计划
 * ```
 */
export interface SearchWorkspace {
  /** 工作区根目录 */
  readonly rootDir: string
  /** 材料存储目录 */
  readonly materialsDir: string
  /** Searcher 搜索保存的目录 */
  readonly searchDir: string
  /** Seed URL 抓取保存的目录 */
  readonly seedsDir: string
  /** 本地书籍转换保存的目录 */
  readonly booksDir: string
  /** Skills 目录 */
  readonly skillsDir: string
  /** 索引文件路径 */
  readonly indexPath: string
  /** 完整文件映射表路径 */
  readonly referenceIndexPath: string
  /** 搜索计划文件路径 */
  readonly planPath: string
}

// ---------------------------------------------------------------------------
// Search Plan
// ---------------------------------------------------------------------------

/**
 * Planner 输出的搜索计划。
 */
export interface SearchPlan {
  /** 研究目标（用户输入或 Planner 精炼后的） */
  readonly goal: string
  /** 搜索维度列表 */
  readonly dimensions: SearchDimension[]
  /** Planner 的分析说明 */
  readonly reasoning?: string
  /** Planner 决策：研究信息已足够，无需继续迭代 */
  readonly isComplete?: boolean
  /** 本轮仍存在的知识缺口（用于下轮 Planner 注入） */
  readonly gaps?: readonly string[]
}

// ---------------------------------------------------------------------------
// Search Result
// ---------------------------------------------------------------------------

/** 单个已保存的材料文件记录 */
export interface SavedMaterial {
  /** 文件相对路径（相对于 materialsDir） */
  readonly relativePath: string
  /** 文件绝对路径 */
  readonly absolutePath: string
  /** 来源 URL（如果有） */
  readonly sourceUrl?: string
  /** 来源类型 */
  readonly source: 'search' | 'seed' | 'book'
  /** 所属维度 ID（search 类型时有值） */
  readonly dimensionId?: string
  /** 文件标题（从 Markdown 提取） */
  readonly title?: string
  /** 二级标题列表（用于生成索引） */
  readonly headings?: readonly string[]
  /** 内容摘要（首段正文，最长 200 字符） */
  readonly summary?: string
}

/** 搜索阶段最终结果 */
export interface DeepResearchSearchResult {
  /** 工作区信息 */
  readonly workspace: SearchWorkspace
  /** 使用的搜索计划 */
  readonly plan: SearchPlan
  /** 所有已保存的材料文件 */
  readonly materials: readonly SavedMaterial[]
  /** 生成的索引文件路径 */
  readonly indexPath: string
  /** 完整文件映射表路径 */
  readonly referenceIndexPath: string
  /** 统计信息 */
  readonly stats: {
    readonly totalFiles: number
    readonly searchFiles: number
    readonly seedFiles: number
    readonly bookFiles: number
    readonly totalDimensions: number
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** DeepResearch 搜索阶段配置 */
export interface DeepResearchSearchOptions {
  /** 研究目标（必填） */
  goal: string

  /**
   * 工作区根目录。
   * 默认: `{cwd}/deep-research/{sanitized-goal}-{timestamp}/`
   */
  workspaceDir?: string

  /**
   * 用户指定的搜索维度。
   * 留空则由 Planner 自动规划。
   */
  dimensions?: SearchDimension[]

  /**
   * 种子 URL 列表（GitHub awesome 列表、资源汇总页等）。
   */
  seedUrls?: SeedUrl[]

  /**
   * 本地书籍文件列表（PDF）。
   * 会通过 pdf-to-md 转换并按章拆分后加入材料。
   */
  localBooks?: LocalBook[]

  /** 模型名称 */
  model?: string
  /**
   * 书籍 Chunk Summarizer 使用的轻量模型。
   * 用于对无标题结构的书籍进行并行摘要，默认使用 process.env.DEFAULT_MODEL。
   */
  summarizeModel?: string
  /**
   * 迭代搜索循环最大轮数（默认 3）。
   * 每轮结束后 Planner 反思已有发现，决定是否继续或终止。
   */
  maxIterations?: number
  /** Searcher 最大并发数（默认 4） */
  maxSearchConcurrency?: number

  /** Seed URL 抓取最大并发数（默认 2） */
  maxSeedConcurrency?: number

  /** 子链接并行抓取并发数（默认 5） */
  maxSubLinkConcurrency?: number

  /** 每个种子 URL 最多抓取的子链接数量（默认 30） */
  maxSubLinks?: number

  /** Planner Agent 的额外系统提示 */
  plannerSystemPromptExtra?: string

  /** Searcher Agent 的额外系统提示（追加到每个 Searcher） */
  searcherSystemPromptExtra?: string

  /** 每个 Agent 的最大 turn 数 */
  maxTurns?: number

  /** 超时时间（毫秒） */
  timeoutMs?: number

  /** SDK 选项透传 */
  sdkOptions?: Partial<ClaudeAgentOptions>

  /**
   * 项目内 skill_hub 目录路径。
   * 优先从此目录安装搜索 skill 到工作区。
   */
  skillHubDir?: string

  /** 进度回调 */
  onProgress?: (event: DeepResearchProgressEvent) => void
}

/** 进度事件 */
export interface DeepResearchProgressEvent {
  readonly type:
    | 'workspace_created'
    | 'plan_start'
    | 'plan_complete'
    | 'seed_crawl_start'
    | 'seed_crawl_complete'
    | 'seed_crawl_error'
    | 'seed_crawl_progress'
    | 'search_start'
    | 'search_dimension_start'
    | 'search_dimension_complete'
    | 'search_dimension_error'
    | 'search_complete'
    | 'book_load_start'
    | 'book_load_progress'
    | 'book_load_complete'
    | 'book_load_error'
    | 'index_start'
    | 'index_progress'
    | 'index_complete'
    | 'iteration_start'
    | 'iteration_complete'
    | 'reflect_complete'
  readonly detail?: string
  readonly data?: Record<string, unknown>
}
