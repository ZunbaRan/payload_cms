# Deep Research — 进度与规划

## 当前进度

### 第一阶段：Search Phase ✅

`runSearchPhase()` — 三合一素材收集，已全部实现并编译通过。

| 数据源 | 模块 | 状态 | 说明 |
|--------|------|------|------|
| Seed URLs | `seed-crawler.ts` | ✅ 完成 | GitHub awesome-list + 子链接递归抓取，PDF/Web 双通道并行 |
| Local Books | `book-loader.ts` | ✅ 完成 | PDF → TOC 提取 → pdf-to-md OCR 转换 → 按章拆分 |
| Web Search | `searcher.ts` + `planner.ts` | ✅ 完成 | AI 规划搜索维度 → 多维度并行搜索 → 保存为 Markdown |

#### 辅助模块

| 模块 | 状态 | 说明 |
|------|------|------|
| `doc-formatter.ts` | ✅ 完成 | Agent 驱动的文档格式化（修复标题/层级/乱码，提取大纲） |
| `index-generator.ts` | ✅ 完成 | 统一索引生成，支持 H3 三级标题，过滤失败下载，跳过 index.md |
| `workspace.ts` | ✅ 完成 | 工作区目录结构（materials/search + seeds + books） |
| `types.ts` | ✅ 完成 | 完整类型定义，含 LocalBook、'book' source type |

### 第二阶段：Analysis Phase 🔲（暂缓）

计划内容：
- 基于 INDEX.md 的素材分析与知识图谱构建
- 跨素材交叉引用与主题聚类
- 关键洞见提取与冲突检测

## 后续规划

### P0：接入 course-creator ← 当前重点

**目标**：用 deep-research 的 `runSearchPhase()` 替换 course-creator Stage A 中的 4x Parallel Searcher，
同时完全替代 `course-creator-from-book`（不再需要单独的 from-book 流程）。

**设计思路**：

1. **新建 `course-creator-v2/`**（或改造现有 `course-creator/`），Stage A 变为：
   - ~~4x Parallel Searcher~~ → `runSearchPhase()` 三合一素材收集
   - Outliner / Scorer / Decider 保持不变
   - 素材上下文来源从 Searcher 输出 → INDEX.md + 文件内容

2. **统一的 Config**：
   ```ts
   interface CourseCreatorV2Config {
     topic: string
     // 三合一素材源（全部可选，至少填一个）
     seedUrls?: SeedUrl[]
     localBooks?: LocalBook[]
     dimensions?: SearchDimension[]  // 手动指定搜索维度
     // 原有配置
     context?: CourseContext
     model?: string
     maxRounds?: number
     passThreshold?: number
     outputDir?: string
   }
   ```

3. **Stage A 新流程**：
   ```
   runSearchPhase(seedUrls + localBooks + dimensions)
     → INDEX.md + materials/
     → Outliner(INDEX.md 作为素材上下文)
     → Scorer → Decider → Loop
   ```

4. **Stage B 适配**：
   - Writer 的素材上下文从 Searcher 输出 → materials/ 目录的文件内容
   - 如果有 localBooks，Writer 可以引用书籍章节（faithfulness 维度）
   - 如果只有 seedUrls/search，行为与当前 course-creator 一致

5. **course-creator-from-book 可废弃**：
   - `book-parser.ts` 的职责被 `book-loader.ts` 接管
   - MaterialAnalyzer 被 `runSearchPhase()` 的 INDEX.md 替代
   - 其余 Outliner/Scorer/Decider 逻辑合并到统一 pipeline

### P1：完善 doc-formatter

- 当前 formatter 依赖 ClaudeAgent 逐文件格式化，成本较高
- 考虑对 PDF 转换结果使用轻量规则（正则）做初步清理，只对质量差的文件调 Agent
- 增加格式化质量检测（标题是否合理、内容是否完整）

### P2：Analysis Phase

- 素材分析、知识图谱、交叉引用
- 依赖 P0 完成后的实际使用反馈来确定具体需求
