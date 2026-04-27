/**
 * @fileoverview Deep Research — Search Phase Orchestrator.
 *
 * 主入口函数 `runSearchPhase()`，按顺序执行：
 * 1. 创建工作区 → 2. 抓取种子 URL → 3. 规划搜索维度 → 4. 并行搜索 → 5. 生成索引
 *
 * 返回 DeepResearchSearchResult，供下游分析阶段使用。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type {
  DeepResearchSearchOptions,
  DeepResearchSearchResult,
  DeepResearchProgressEvent,
  SearchPlan,
  SavedMaterial,
  SearchWorkspace,
} from './types.js'
import { createSearchWorkspace } from './workspace.js'
import { crawlSeedUrl } from './seed-crawler.js'
import { loadLocalBooks } from './book-loader.js'
import { planSearchDimensions, buildPlanFromDimensions } from './planner.js'
import { runParallelSearchers } from './searcher.js'
import { generateIndex } from './index-generator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateWorkspaceDir(goal: string): string {
  const sanitized = goal.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-').slice(0, 40).replace(/-+$/, '')
  const ts = new Date().toISOString().slice(0, 10)
  return path.join(os.tmpdir(), 'deep-research', `${sanitized}-${ts}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 执行深度研究的搜索阶段。
 *
 * @example
 * ```ts
 * const result = await runSearchPhase({
 *   goal: 'AI Agent frameworks in 2025',
 *   seedUrls: [{ url: 'https://github.com/user/awesome-agents', label: 'awesome' }],
 *   model: 'claude-sonnet-4-20250514',
 *   onProgress: (e) => console.log(e.type, e.detail),
 * })
 * console.log(`Saved ${result.stats.totalFiles} files → ${result.indexPath}`)
 * ```
 */
export async function runSearchPhase(
  options: DeepResearchSearchOptions,
): Promise<DeepResearchSearchResult> {
  const {
    goal,
    workspaceDir,
    dimensions: userDimensions,
    seedUrls,
    localBooks,
    model,
    summarizeModel,
    maxIterations = 3,
    maxSearchConcurrency = 4,
    maxSeedConcurrency = 2,
    maxSubLinkConcurrency = 5,
    maxSubLinks,
    plannerSystemPromptExtra,
    searcherSystemPromptExtra,
    maxTurns,
    timeoutMs,
    sdkOptions = {},
    skillHubDir,
    onProgress,
  } = options

  const emit = (type: DeepResearchProgressEvent['type'], detail?: string, data?: Record<string, unknown>) => {
    onProgress?.({ type, detail, data })
  }

  // ------- 1. 创建工作区 -------
  const rootDir = workspaceDir ?? generateWorkspaceDir(goal)
  const workspace: SearchWorkspace = createSearchWorkspace(rootDir, skillHubDir)
  emit('workspace_created', `Workspace: ${workspace.rootDir}`)

  // 合并 SDK 选项
  const mergedSdk = {
    ...sdkOptions,
    model: model ?? sdkOptions.model ?? '',
    maxTurns: maxTurns ?? sdkOptions.maxTurns,
    timeoutMs: timeoutMs ?? sdkOptions.timeoutMs,
  }

  // ------- 2. 并行抓取种子 URL + 加载本地书籍 -------
  const seedPromise: Promise<SavedMaterial[]> = (async () => {
    const seedMaterials: SavedMaterial[] = []
    if (!seedUrls || seedUrls.length === 0) return seedMaterials

    emit('seed_crawl_start', `Crawling ${seedUrls.length} seed URLs`)
    for (let i = 0; i < seedUrls.length; i += maxSeedConcurrency) {
      const batch = seedUrls.slice(i, i + maxSeedConcurrency)
      const promises = batch.map(async (seed) => {
        try {
          return await crawlSeedUrl(
            seed,
            workspace,
            mergedSdk,
            (msg) => emit('seed_crawl_progress', msg),
            maxSubLinkConcurrency,
            maxSubLinks,
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          emit('seed_crawl_error', `Seed "${seed.url}" failed: ${msg}`)
          return []
        }
      })
      const results = await Promise.all(promises)
      for (const r of results) seedMaterials.push(...r)
    }
    emit('seed_crawl_complete', `Crawled ${seedMaterials.length} seed pages`)
    return seedMaterials
  })()

  const bookPromise: Promise<SavedMaterial[]> = (async () => {
    const bookMaterials: SavedMaterial[] = []
    if (!localBooks || localBooks.length === 0) return bookMaterials

    emit('book_load_start', `Loading ${localBooks.length} local books`)
    try {
      const results = await loadLocalBooks(
        localBooks,
        workspace,
        skillHubDir,
        (msg) => emit('book_load_progress', msg),
        summarizeModel,
      )
      bookMaterials.push(...results)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emit('book_load_error', `Book loading failed: ${msg}`)
    }
    emit('book_load_complete', `Loaded ${bookMaterials.length} chapter files from ${localBooks.length} books`)
    return bookMaterials
  })()

  // 种子抓取与书籍转换并行
  await Promise.all([seedPromise, bookPromise])

  // ------- 2b. 初始 External Memory（汇总种子/书籍内容）-------
  emit('index_start', 'Building initial External Memory from seeds/books...')
  await generateIndex(workspace, {
    onProgress: (msg) => emit('index_progress', msg),
  })
  emit('index_complete', 'Initial External Memory ready')

  // ------- 3. 迭代搜索循环（Plan → Execute → Reflect → Refine）-------
  // 无论用户是否指定维度，都走 loop：
  // - 用户指定维度：第一轮直接执行，后续 Planner 基于 External Memory 验证并补充
  // - AI 规划维度：每轮 Planner 从零或从反思出发规划
  let lastPlan: SearchPlan = buildPlanFromDimensions(goal, [])
  let totalSearchDimensions = 0

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    emit('iteration_start', `Iteration ${iteration}/${maxIterations}`)

    // 读取当前 External Memory 注入 Planner
    const indexContent = fs.existsSync(workspace.indexPath)
      ? fs.readFileSync(workspace.indexPath, 'utf-8').slice(0, 8000)
      : ''

    let plan: SearchPlan

    if (iteration === 1 && userDimensions && userDimensions.length > 0) {
      // 第一轮：优先使用用户指定维度，不调用 Planner（尊重用户意图）
      plan = buildPlanFromDimensions(goal, userDimensions)
      emit('plan_complete', `Iteration 1: using ${plan.dimensions.length} user-defined dimensions`)
    } else {
      // 后续轮（或未指定维度）：Planner 基于 External Memory 反思后规划
      emit('plan_start', `Iteration ${iteration}: reflecting on findings, planning next steps...`)
      plan = await planSearchDimensions(goal, workspace, mergedSdk, {
        extraPrompt: plannerSystemPromptExtra,
        iteration,
        maxIterations,
        indexContent,
      })
    }

    lastPlan = plan
    fs.writeFileSync(
      workspace.planPath,
      JSON.stringify({ ...plan, iteration }, null, 2),
      'utf-8',
    )

    if (plan.isComplete || plan.dimensions.length === 0) {
      emit('reflect_complete', `Research sufficient after ${iteration - 1} search iteration(s): ${plan.reasoning ?? ''}`)
      break
    }

    emit('plan_complete', `Iteration ${iteration}: ${plan.dimensions.length} dimensions — ${plan.dimensions.map(d => d.title).join(', ')}`)
    emit('search_start', `Iteration ${iteration}: searching ${plan.dimensions.length} dimensions`)

    await runParallelSearchers(
      plan.dimensions,
      goal,
      workspace,
      mergedSdk,
      maxSearchConcurrency,
      searcherSystemPromptExtra,
      (msg) => {
        if (msg.includes('Starting')) emit('search_dimension_start', msg)
        else if (msg.includes('saved')) emit('search_dimension_complete', msg)
        else if (msg.includes('failed')) emit('search_dimension_error', msg)
      },
    )
    totalSearchDimensions += plan.dimensions.length
    emit('search_complete', `Iteration ${iteration} search done`)

    // 更新 External Memory（轻量刷新，不做 AI 摘要）
    emit('index_start', `Updating External Memory after iteration ${iteration}...`)
    await generateIndex(workspace, {
      onProgress: (msg) => emit('index_progress', msg),
    })
    emit('index_complete', `External Memory updated (iteration ${iteration})`)
    emit('iteration_complete', `Iteration ${iteration}/${maxIterations} complete`)
  }

  // ------- 4. 最终索引（含 AI 摘要）-------
  emit('index_start', 'Generating final INDEX.md + index-reference.md with AI summaries...')
  const effectiveSummarizeModel = summarizeModel ?? process.env.FLASH_MODEL ?? process.env.DEFAULT_MODEL
  const { materials: allMaterials, referenceIndexPath } = await generateIndex(workspace, {
    summarizeModel: effectiveSummarizeModel,
    onProgress: (msg) => emit('index_progress', msg),
  })
  emit('index_complete', `Final index: ${allMaterials.length} total files`)

  // ------- 汇总结果 -------
  return {
    workspace,
    plan: lastPlan,
    materials: allMaterials,
    indexPath: workspace.indexPath,
    referenceIndexPath,
    stats: {
      totalFiles: allMaterials.length,
      searchFiles: allMaterials.filter(m => m.source === 'search').length,
      seedFiles: allMaterials.filter(m => m.source === 'seed').length,
      bookFiles: allMaterials.filter(m => m.source === 'book').length,
      totalDimensions: totalSearchDimensions,
    },
  }
}
