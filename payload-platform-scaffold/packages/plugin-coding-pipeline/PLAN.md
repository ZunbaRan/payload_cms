# plugin-coding-pipeline — 开发计划

把 `workflow/coding_pipline` (V3) 的隐式状态机迁移到 Payload CMS：
**Payload 是 control plane，`workflow/core` 是 data plane**。

---

## 设计决策（已拍板）

| # | 决策 |
|---|---|
| 1 | **Payload 是 source of truth**。Phase 启动前由 hook 把 DB 内容渲染回 `openspec/changes/<name>/*.md` 与 `MEMORY.md` 给 Agent 用；Phase 结束后再读回硬盘 diff 入库。 |
| 2 | **Ralph Loop 在单个 job 内部循环**。重启 = 重跑该 phase。 |
| 3 | **只服务 V3 五段流程**：`prepare → plan → code → test → reflect`，phaseName 用枚举写死，不做通用 pipelineDefinitions。 |
| 4 | **`workflow/core` 保持独立**。本 plugin 仅 import `ClaudeAgent` / `PipelineTracer`，不耦合内部实现。 |
| 5 | **支持人工 override**。Reflector 给出 verdict 后进入 `awaiting-review`，admin 可在 UI 改写 `manualVerdict` 再放行。 |

---

## 模块划分

```
src/
├── index.ts                    # codingPipelinePlugin() 入口
├── types.ts                    # 共享类型 / 枚举（PhaseName 等）
├── collections/                # 17 个 collection（精简后）
│   ├── index.ts
│   ├── Models.ts
│   ├── Skills.ts
│   ├── AgentRoles.ts
│   ├── PromptTemplates.ts
│   ├── Projects.ts
│   ├── Requirements.ts
│   ├── Runs.ts
│   ├── OuterLoops.ts
│   ├── Phases.ts
│   ├── RalphIterations.ts
│   ├── AgentInvocations.ts
│   ├── ToolCalls.ts
│   ├── TraceEvents.ts
│   ├── OpenSpecChanges.ts
│   ├── BddSpecs.ts
│   ├── Tasks.ts
│   └── MemorySnapshots.ts
├── jobs/
│   ├── index.ts
│   ├── runPipeline.ts          # 创建 Run / OuterLoop / 5 个 Phases，把第一个排进队列
│   ├── runPhase.ts             # 读 phase → render artifacts → 调 ClaudeAgent → 收尾
│   └── archiveOpenSpec.ts      # accepted 后归档
├── hooks/
│   ├── index.ts
│   ├── renderArtifactsToDisk.ts  # 决策 1：DB → 文件
│   ├── ingestArtifactsFromDisk.ts# 文件 → DB（phase 结束）
│   ├── validateOpenSpec.ts     # plan 完成后校验产物完整性
│   ├── reflectorVerdict.ts     # 解析 ACCEPTED / REVISE，开下一个 outerLoop
│   └── progressMemory.ts       # MEMORY.md §0 自动写
├── runtime/
│   ├── claudeBridge.ts         # 包一次 ClaudeAgent，注入 Payload tracer sink
│   ├── ralph.ts                # Ralph 循环（仍然是同步函数，落库到 ralphIterations）
│   ├── promptBuilder.ts        # 按 phase 拼用户 prompt
│   └── tracerSink.ts           # AgentLogEvent → traceEvents / toolCalls
└── seed/
    ├── index.ts
    └── v3Defaults.ts           # 写入 4 个 agentRoles + 4 条 promptTemplates
```

---

## Collection 关系总览

```
projects ─┐
          └─< requirements ─< runs ─< outerLoops ─< phases ─< agentInvocations ─< toolCalls
                                                       │                       └< traceEvents
                                                       ├─< ralphIterations
                                                       └─< memorySnapshots
                                  runs ─< openspecChanges ─┬─< bddSpecs
                                                           └─< tasks

models ─< agentRoles ─< promptTemplates
skills ─< agentRoles (m2m)
```

---

## 核心数据流

### 启动一次 Run

1. `POST /api/runs` 或 MCP `pipeline.startRun` → 创建 `runs` 记录（status=queued）
2. `afterChange` hook 调度 `runPipeline` job
3. `runPipeline`：
   - 从 `pipelineDefinitions`（写死五段）创建 `outerLoops[0]` + 5 个 `phases`
   - 把 `phase[prepare]` 入 `runPhase` 队列

### 单个 Phase 执行（`runPhase` job）

```text
┌─ 取 phase + 关联 (run, project, role, prompt template, openspec change)
│
├─ beforeRun hook: renderArtifactsToDisk
│    把 DB 中 proposal.md / specs/*.md / tasks.md / MEMORY.md 回写到 git worktree
│
├─ 构造 ClaudeAgent（systemPrompt 从 promptTemplates 取）
│    onEvent → tracerSink → 实时写 traceEvents / toolCalls / agentInvocations
│
├─ 如果是 test 阶段：runtime/ralph.ts 内部循环，每轮写 ralphIterations
│    其它阶段：单次 agent.run()
│
├─ afterRun hook: ingestArtifactsFromDisk
│    把磁盘上的变更读回 openspecChanges / bddSpecs / tasks / memorySnapshots
│
├─ phase 专属验证：
│    plan   → validateOpenSpec
│    test   → 检查 specs 是否全跑通（从 agent 输出解析）
│    reflect→ reflectorVerdict（写 outerLoops.verdict / 触发下一轮）
│
└─ 标记 phase=done，调度下一个 phase（或外层循环）
```

### 人工 override

`outerLoops.verdict` 来自 Reflector，admin 在 UI 编辑 `manualVerdict` 即触发 `afterChange`：
- accept → 调 `archiveOpenSpec` job
- revise → 用 `manualNote` 当新需求，新建 outerLoops[n+1]

---

## 开发顺序（小步快跑，每步可独立跑通）

| Step | 内容 | 产出 | 状态 |
|------|------|------|------|
| **S1** | collections + 基础 hooks 占位 | `pnpm payload generate:types` 通过 | ✅ |
| **S2** | seed v3 defaults（5 个 agentRoles + 5 条 prompt 模板，原文从 prompts.ts 迁移） | `seed/promptBodies.ts` 内联 5 段真实 prompt，启动后 UI 可见 | ✅ |
| **S3** | `runtime/claudeBridge` + `tracerSink`，调用 `workflow/core` 的 `ClaudeAgent`；事件全量落库 | 端到端最小链路；动态 import 解耦 | ✅ |
| **S4** | `runPhase` for prepare 阶段做 git/CLAUDE.md；jobs 链路接通（`runPipeline` 入队 prepare、`runPhase.scheduleNextPhase` 入队下一段） | git 分支 + 阶段链 | ✅ |
| **S5** | render/ingest hooks，artifacts DB↔FS 双向 | （随 S1 完成） | ✅ |
| **S6** | reflectorVerdict + OuterLoops afterChange：autoAdvance / manualVerdict 优先级；revise → 自动 spawn 下一个 outerLoop（`spawnOuterLoop` 共享给 runPipeline） | 自动跑完一次 outer loop 并切到下一轮 | ✅ |
| **S7** | manualVerdict + archive | accepted → 入 `archiveOpenSpec` 队列 | ✅ |
| **S8** | MCP 暴露：`pipeline.startRun` / `getRunStatus` / `replayPhase` | 可被上层 Agent 调度 | ⏭️ 留待 |

---

## 与 `workflow/core` 的边界

| 谁负责 | 职责 |
|--------|------|
| `workflow/core/agent/claude-agent.ts` | LLM 调用、工具执行、hook、token 计费 |
| `workflow/core/observability/tracer.ts` | event 发射（不写库；本 plugin 提供 sink） |
| `workflow/core/worktree.ts` | git 操作 |
| 本 plugin | 状态机、持久化、UI、调度、prompt 注册表、artifact 双向同步 |

`workflow/coding_pipline/` 在 S6 完成后即可删除（功能完全被 plugin 取代）。
