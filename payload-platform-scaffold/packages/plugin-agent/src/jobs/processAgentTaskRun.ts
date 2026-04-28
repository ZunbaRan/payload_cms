/**
 * processAgentTaskRun
 *
 * 入参：agentTaskId, agentTaskRunId
 * 流程：
 *   1. 加载 agent-task + skills + ai-model
 *   2. 准备运行目录：.geoflow-data/agent-runs/<runId>/
 *      把所有选中的 skill 复制进去（symlink 也行，跨平台保险用 copy）
 *   3. createBashTool（just-bash sandbox，cwd=运行目录）+ experimental_createSkillTool
 *   4. ToolLoopAgent.generate(prompt) 跑 agent loop
 *   5. 写回 agent-task-runs（status / finalOutput / steps / tokens）
 *
 * 安全：
 *   - 当前用 just-bash（同进程 spawn），cwd 限定在运行目录里，但 *并不是真隔离*
 *   - 想要真隔离把 just-bash 换成 @vercel/sandbox 即可（一行）
 */
import type { TaskConfig } from 'payload'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { getSkillDir } from '../lib/skillStorage'
import { buildLanguageModel } from '../lib/buildModel'

// TODO(remote-sandbox): 当前直接调用宿主机 bash（无隔离），仅用于本地开发测试。
// 未来要拆出独立的 agent runner 服务（例如 fly.io / vercel sandbox / 自建 Firecracker 集群）。
// 平台侧只需把 { prompt, skills(folder tar), variables, model } POST 到远程 endpoint，
// 远程执行完成后回传 { mode: 'text' | 'file', payload } 两种结果。
// 切换时，把下面的 hostBashSandbox 实现替换成 HTTP 客户端调用即可，processAgentTaskRun 主流程不变。

interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * 宿主机 bash 执行（不隔离，仅本地调试用）。
 * cwd 指向 runRoot，因此 agent 既能 `./skills/<slug>/` 访问技能，也能 `./workspace/output.md` 写产物。
 */
function createHostBashSandbox(runRoot: string, timeoutMs: number) {
  return {
    async executeCommand(command: string): Promise<SandboxResult> {
      return await new Promise<SandboxResult>((resolve) => {
        exec(
          command,
          {
            cwd: runRoot,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            shell: '/bin/bash',
            env: { ...process.env },
          },
          (err, stdout, stderr) => {
            const code = err ? ((err as NodeJS.ErrnoException).code as unknown as number) ?? 1 : 0
            resolve({
              stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf-8'),
              stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf-8'),
              exitCode: typeof code === 'number' ? code : 1,
            })
          },
        )
      })
    },
    async readFile(p: string): Promise<string> {
      const abs = path.isAbsolute(p) ? p : path.join(runRoot, p)
      return await fs.readFile(abs, 'utf-8')
    },
    async writeFiles(files: Array<{ path: string; content: string | Buffer }>): Promise<void> {
      for (const f of files) {
        const abs = path.isAbsolute(f.path) ? f.path : path.join(runRoot, f.path)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, f.content)
      }
    },
  }
}

interface AgentTaskDoc {
  id: string | number
  prompt?: string
  skills?: Array<{ id: string | number; slug?: string; name?: string }>
  aiModel?: { provider?: string; modelId?: string; baseUrl?: string; apiKey?: string }
  maxSteps?: number
  timeoutMs?: number
  enableBash?: boolean
  totalRuns?: number
  variables?: Array<{ key?: string; defaultValue?: string }>
  outputMode?: 'text' | 'file'
}

interface AgentTaskRunDoc {
  id: string | number
  inputs?: Record<string, string>
  linkedKnowledgeBase?: string | number | { id: string | number }
}

function applyTemplate(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    const v = vars[k]
    return v == null ? `{{${k}}}` : String(v)
  })
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}

export const processAgentTaskRun: TaskConfig<'processAgentTaskRun'> = {
  slug: 'processAgentTaskRun',
  inputSchema: [
    { name: 'agentTaskId', type: 'text', required: true },
    { name: 'agentTaskRunId', type: 'text', required: true },
    { name: 'kbIndexRunId', type: 'text' },
  ],
  outputSchema: [
    { name: 'finalOutput', type: 'text' },
    { name: 'totalTokens', type: 'number' },
    { name: 'stepCount', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const startedAt = new Date()

    // 标记 running
    await payload.update({
      collection: 'agent-task-runs',
      id: input.agentTaskRunId,
      data: { status: 'running', startedAt: startedAt.toISOString() } as never,
      depth: 0,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'agent-tasks',
      id: input.agentTaskId,
      data: { lastRunStatus: 'running' } as never,
      depth: 0,
      overrideAccess: true,
    })

    const task = (await payload.findByID({
      collection: 'agent-tasks',
      id: input.agentTaskId,
      depth: 2,
    })) as unknown as AgentTaskDoc

    if (!task) throw new Error(`agent-task ${input.agentTaskId} not found`)
    if (!task.prompt) throw new Error('agent-task 缺少 prompt')
    if (!task.aiModel?.provider || !task.aiModel?.modelId) {
      throw new Error('agent-task 缺少 aiModel')
    }

    // 读取 run 的 inputs 和 linkedKnowledgeBase
    const taskRun = (await payload.findByID({
      collection: 'agent-task-runs',
      id: input.agentTaskRunId,
      depth: 0,
    })) as unknown as AgentTaskRunDoc | null
    const runInputs = taskRun?.inputs || {}
    const linkedKbId = taskRun?.linkedKnowledgeBase
      ? typeof taskRun.linkedKnowledgeBase === 'object'
        ? (taskRun.linkedKnowledgeBase as { id: string | number }).id
        : taskRun.linkedKnowledgeBase
      : undefined

    // 应用变量默认值 + 运行时 inputs 覆盖
    const mergedVars: Record<string, string> = {}
    for (const v of task.variables || []) {
      if (v?.key) mergedVars[v.key] = v.defaultValue || ''
    }
    Object.assign(mergedVars, runInputs)

    const effectivePrompt = applyTemplate(task.prompt, mergedVars)

    // 1. 准备运行目录
    const runRoot = path.resolve(
      process.cwd(),
      '.geoflow-data',
      'agent-runs',
      String(input.agentTaskRunId),
    )
    const skillsRoot = path.join(runRoot, 'skills')
    await fs.mkdir(skillsRoot, { recursive: true })
    await fs.mkdir(path.join(runRoot, 'workspace'), { recursive: true })

    // 2. 复制 skill 文件
    const skillNames: string[] = []
    for (const s of task.skills || []) {
      if (!s?.slug) continue
      const src = getSkillDir(s.slug)
      if (!existsSync(src)) {
        payload.logger?.warn?.(`skill dir not found: ${src}`)
        continue
      }
      const dest = path.join(skillsRoot, s.slug)
      await copyDir(src, dest)
      skillNames.push(s.name || s.slug)
    }

    let finalOutput = ''
    let stepCount = 0
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    let totalTokens: number | undefined
    const steps: Array<{ type: string; content?: unknown }> = []

    try {
      // 3. 构建模型 + 工具
      const model = await buildLanguageModel(task.aiModel)

      const aiSdk = (await import('ai')) as typeof import('ai')
      const bashTool = (await import('bash-tool')) as typeof import('bash-tool')

      const toolsOut: Record<string, unknown> = {}

      // skills tool（只要有 skill 就开）
      if ((task.skills || []).length > 0) {
        const created = await bashTool.experimental_createSkillTool({
          skillsDirectory: skillsRoot,
        })
        toolsOut.skill = created.skill
        // 把 SKILL.md 内容拼到 system prompt 里
      }

      // bash tool（可选）
      let extraInstructions = ''
      if (task.enableBash) {
        const hostSandbox = createHostBashSandbox(runRoot, task.timeoutMs || 300000)
        const { tools, instructions } = await bashTool.createBashTool({
          // 用宿主机 bash 沙箱，cwd=runRoot（这样 ./skills/ 和 ./workspace/ 都能直接访问）
          // TODO(remote-sandbox): 上线前替换成远程 sandbox endpoint
          sandbox: hostSandbox,
          destination: runRoot,
        } as never)
        Object.assign(toolsOut, tools)
        extraInstructions = instructions || ''
      }

      const stopWhen = aiSdk.stepCountIs(task.maxSteps || 20)

      const wantsFile = task.outputMode === 'file' || Boolean(linkedKbId)
      const outputFilePath = path.join(runRoot, 'workspace', 'output.md')
      const fileOutputInstructions = wantsFile
        ? [
            '——',
            '【输出协议（重要）】',
            `bash 当前工作目录(cwd)是: ${runRoot}`,
            `请把最终结果（markdown 格式纯文本）写入文件：${outputFilePath}`,
            '可以直接用 `cat > ./workspace/output.md << \'EOF\' ... EOF` 或 writeFile 工具写入。',
            '完成后，最终回复**只**返回这个绝对路径，单行纯文本，不要返回内容、不要加引号、不要解释、不要 markdown 代码块。',
          ].join('\n')
        : ''

      const systemPrompt =
        [
          'You are an autonomous agent. Complete the user task using available tools.',
          'When you are done, output the final answer as plain text and stop.',
          skillNames.length
            ? `You have access to the following skills (located under ./skills/): ${skillNames.join(', ')}.`
            : '',
          extraInstructions,
          fileOutputInstructions,
        ]
          .filter(Boolean)
          .join('\n\n')

      const AgentCtor = (aiSdk as unknown as {
        ToolLoopAgent?: new (cfg: unknown) => {
          generate: (input: { prompt: string }) => Promise<unknown>
        }
      }).ToolLoopAgent

      let resultUnknown: unknown

      if (AgentCtor) {
        const agent = new AgentCtor({
          model,
          tools: toolsOut,
          system: systemPrompt,
          stopWhen,
        })
        // 超时控制
        resultUnknown = await Promise.race([
          agent.generate({ prompt: effectivePrompt }),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('agent execution timed out')), task.timeoutMs || 300000),
          ),
        ])
      } else {
        // 兼容 fallback：用 generateText + tools 自循环
        const generateText = (aiSdk as unknown as {
          generateText: (cfg: unknown) => Promise<unknown>
        }).generateText
        resultUnknown = await Promise.race([
          generateText({
            model,
            tools: toolsOut,
            system: systemPrompt,
            prompt: effectivePrompt,
            stopWhen,
          }),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('agent execution timed out')), task.timeoutMs || 300000),
          ),
        ])
      }

      const result = resultUnknown as {
        text?: string
        steps?: unknown[]
        usage?: {
          promptTokens?: number
          inputTokens?: number
          completionTokens?: number
          outputTokens?: number
          totalTokens?: number
        }
      }

      finalOutput = result.text || ''
      stepCount = Array.isArray(result.steps) ? result.steps.length : 0
      promptTokens = result.usage?.promptTokens ?? result.usage?.inputTokens
      completionTokens = result.usage?.completionTokens ?? result.usage?.outputTokens
      totalTokens = result.usage?.totalTokens
      if (Array.isArray(result.steps)) {
        for (const step of result.steps as Array<Record<string, unknown>>) {
          steps.push({
            type: (step.stepType as string) || 'step',
            content: {
              text: step.text,
              toolCalls: step.toolCalls,
              toolResults: step.toolResults,
            },
          })
        }
      }
    } catch (e) {
      const err = e as Error
      const finishedAt = new Date()
      await payload.update({
        collection: 'agent-task-runs',
        id: input.agentTaskRunId,
        data: {
          status: 'failed',
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: err.message || String(e),
          effectivePrompt,
          steps,
          stepCount,
        } as never,
        depth: 0,
        overrideAccess: true,
      })
      await payload.update({
        collection: 'agent-tasks',
        id: input.agentTaskId,
        data: {
          lastRunAt: finishedAt.toISOString(),
          lastRunStatus: 'failed',
          totalRuns: ((task.totalRuns as number) || 0) + 1,
        } as never,
        depth: 0,
        overrideAccess: true,
      })
      // 同步失败到 kb-index-runs
      if (input.kbIndexRunId) {
        try {
          await payload.update({
            collection: 'kb-index-runs',
            id: input.kbIndexRunId,
            data: {
              status: 'failed',
              finishedAt: finishedAt.toISOString(),
              durationMs: finishedAt.getTime() - startedAt.getTime(),
              message: `agent 抓取失败：${err.message || String(e)}`,
            } as never,
            depth: 0,
            overrideAccess: true,
          })
          if (linkedKbId) {
            await payload.update({
              collection: 'knowledge-bases',
              id: linkedKbId,
              data: { syncStatus: 'failed' } as never,
              depth: 0,
              overrideAccess: true,
              context: { skipChunk: true },
            })
          }
        } catch (e2) {
          payload.logger?.warn?.(`update kb-index-run failed: ${(e2 as Error).message}`)
        }
      }
      throw e
    }

    const finishedAt = new Date()

    // 如果绑定了 KB → 把 finalOutput 当作绝对路径，读文件回写 KB.rawContent
    let kbWriteMessage: string | undefined
    if (linkedKbId) {
      try {
        // 解析 agent 返回的路径：取最后一行非空文本，去掉常见包裹（反引号/引号/markdown 代码块）
        const lines = (finalOutput || '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('```'))
        let candidate = lines[lines.length - 1] || ''
        candidate = candidate.replace(/^[`'"]+|[`'"]+$/g, '').trim()
        if (!candidate) throw new Error(`agent 没有返回任何路径，finalOutput=${JSON.stringify(finalOutput)}`)
        // 相对路径按 runRoot 解析
        const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(runRoot, candidate)
        // 安全：限制必须在 .geoflow-data/agent-runs 目录树内
        const allowedRoot = path.resolve(process.cwd(), '.geoflow-data')
        if (!abs.startsWith(allowedRoot)) {
          throw new Error(`agent 返回的路径不在允许目录内：${abs}（解析前: ${candidate}）`)
        }
        if (!existsSync(abs)) throw new Error(`agent 返回的文件不存在：${abs}（解析前: ${candidate}）`)
        const content = await fs.readFile(abs, 'utf-8')
        await payload.update({
          collection: 'knowledge-bases',
          id: linkedKbId,
          data: { rawContent: content, syncStatus: 'pending' } as never,
          depth: 0,
          overrideAccess: true,
          // 走 hook 也行，但这里直接 skip 防止重复 update
          context: { skipChunk: true },
        })
        kbWriteMessage = `已写入 KB.rawContent（${content.length} 字符），可点「📚 开始索引」继续`
      } catch (e) {
        kbWriteMessage = `KB 回写失败：${(e as Error).message}`
        payload.logger?.warn?.(kbWriteMessage)
        if (input.kbIndexRunId) {
          await payload.update({
            collection: 'kb-index-runs',
            id: input.kbIndexRunId,
            data: {
              status: 'failed',
              finishedAt: finishedAt.toISOString(),
              durationMs: finishedAt.getTime() - startedAt.getTime(),
              message: kbWriteMessage,
            } as never,
            depth: 0,
            overrideAccess: true,
          })
        }
        await payload.update({
          collection: 'agent-task-runs',
          id: input.agentTaskRunId,
          data: {
            status: 'failed',
            errorMessage: kbWriteMessage,
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            finalOutput,
            effectivePrompt,
            steps,
            stepCount,
            promptTokens,
            completionTokens,
            totalTokens,
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'agent-tasks',
          id: input.agentTaskId,
          data: {
            lastRunAt: finishedAt.toISOString(),
            lastRunStatus: 'failed',
            totalRuns: ((task.totalRuns as number) || 0) + 1,
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        throw new Error(kbWriteMessage)
      }
    }

    await payload.update({
      collection: 'agent-task-runs',
      id: input.agentTaskRunId,
      data: {
        status: 'success',
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        finalOutput,
        effectivePrompt,
        steps,
        stepCount,
        promptTokens,
        completionTokens,
        totalTokens,
      } as never,
      depth: 0,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'agent-tasks',
      id: input.agentTaskId,
      data: {
        lastRunAt: finishedAt.toISOString(),
        lastRunStatus: 'success',
        totalRuns: ((task.totalRuns as number) || 0) + 1,
      } as never,
      depth: 0,
      overrideAccess: true,
    })

    // 同步成功到 kb-index-runs（kind=fetch 场景）
    if (input.kbIndexRunId) {
      try {
        await payload.update({
          collection: 'kb-index-runs',
          id: input.kbIndexRunId,
          data: {
            status: 'success',
            phase: 'done',
            progress: 100,
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            message: kbWriteMessage || '抓取成功',
          } as never,
          depth: 0,
          overrideAccess: true,
        })
      } catch (e) {
        payload.logger?.warn?.(`update kb-index-run success failed: ${(e as Error).message}`)
      }
    }

    return {
      output: {
        finalOutput,
        totalTokens: totalTokens ?? 0,
        stepCount,
      },
    }
  },
}
