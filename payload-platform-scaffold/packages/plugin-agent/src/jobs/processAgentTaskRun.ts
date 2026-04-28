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
import { getSkillDir } from '../lib/skillStorage'
import { buildLanguageModel } from '../lib/buildModel'

interface AgentTaskDoc {
  id: string | number
  prompt?: string
  skills?: Array<{ id: string | number; slug?: string; name?: string }>
  aiModel?: { provider?: string; modelId?: string; baseUrl?: string; apiKey?: string }
  maxSteps?: number
  timeoutMs?: number
  enableBash?: boolean
  totalRuns?: number
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
        const { tools, instructions } = await bashTool.createBashTool({
          // 不传 sandbox → 默认 just-bash，cwd=workspace
          destination: path.join(runRoot, 'workspace'),
        } as never)
        Object.assign(toolsOut, tools)
        extraInstructions = instructions || ''
      }

      const stopWhen = aiSdk.stepCountIs(task.maxSteps || 20)

      const systemPrompt =
        [
          'You are an autonomous agent. Complete the user task using available tools.',
          'When you are done, output the final answer as plain text and stop.',
          skillNames.length
            ? `You have access to the following skills (located under ./skills/): ${skillNames.join(', ')}.`
            : '',
          extraInstructions,
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
          agent.generate({ prompt: task.prompt }),
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
            prompt: task.prompt,
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
      throw e
    }

    const finishedAt = new Date()
    await payload.update({
      collection: 'agent-task-runs',
      id: input.agentTaskRunId,
      data: {
        status: 'success',
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        finalOutput,
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

    return {
      output: {
        finalOutput,
        totalTokens: totalTokens ?? 0,
        stepCount,
      },
    }
  },
}
