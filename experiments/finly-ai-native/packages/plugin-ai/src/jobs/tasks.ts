import type { TaskConfig } from 'payload'
import { generateTags, classifyImportance } from '@finly/shared/ai'
import { upsertNote } from '@finly/shared/chroma'
import { trackUsage } from '@finly/shared/track'

/**
 * Job: 为笔记生成标签 + 判断重要性 + 写入 Chroma 向量库
 *
 * 流程：
 *  1. 从 AiConfig Global 读取运行时 Prompt / 模型配置
 *  2. 调用 AI 生成标签、判断重要性（同时拿到 token 用量）
 *  3. 写入 TokenUsage Collection（可观测性）
 *  4. Upsert 笔记到 Chroma（语义搜索）
 *  5. 更新笔记字段
 */
export const processNoteTask: TaskConfig<'processNote'> = {
  slug: 'processNote',
  retries: 2,
  inputSchema: [{ name: 'noteId', type: 'text', required: true }],
  outputSchema: [
    { name: 'tags', type: 'json' },
    { name: 'important', type: 'checkbox' },
    { name: 'vectorized', type: 'checkbox' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req

    // 1. 读取 AiConfig Global
    const aiCfg: any = await payload.findGlobal({
      slug: 'ai-config',
      overrideAccess: true,
    })

    const globalModel: string = aiCfg?.modelId || ''

    // 2. 读取笔记
    const note: any = await payload.findByID({
      collection: 'notes',
      id: input.noteId,
      depth: 0,
      overrideAccess: true,
    })

    const content: string = note.content || ''

    // 3. AI 调用
    const tagsConfig = {
      modelId: aiCfg?.generateTags?.modelId || globalModel || undefined,
      promptTemplate: aiCfg?.generateTags?.prompt || undefined,
      maxTokens: aiCfg?.generateTags?.maxTokens || undefined,
    }
    const importanceConfig = {
      modelId: aiCfg?.classifyImportance?.modelId || globalModel || undefined,
      promptTemplate: aiCfg?.classifyImportance?.prompt || undefined,
      maxTokens: aiCfg?.classifyImportance?.maxTokens || undefined,
    }

    const [tagsResult, importanceResult] = await Promise.all([
      note.tags?.length > 0
        ? Promise.resolve({ output: note.tags as string[], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, messages: [] })
        : generateTags(note.title, content, tagsConfig),
      classifyImportance(note.title, content, importanceConfig),
    ])

    // 4. 记录 Token 用量
    await Promise.all([
      tagsResult.usage.totalTokens > 0
        ? trackUsage(payload, {
            result: tagsResult,
            modelId: tagsConfig.modelId || globalModel,
            scene: 'generateTags',
            relatedNote: input.noteId,
          })
        : Promise.resolve(),
      trackUsage(payload, {
        result: importanceResult,
        modelId: importanceConfig.modelId || globalModel,
        scene: 'classifyImportance',
        relatedNote: input.noteId,
      }),
    ])

    // 5. Upsert 到 Chroma
    let vectorized = false
    let chromaId: string | undefined
    try {
      await upsertNote(String(input.noteId), `${note.title}\n\n${content}`, {
        title: note.title,
        tags: tagsResult.output.join(','),
        isImportant: importanceResult.output.important,
      })
      vectorized = true
      chromaId = String(input.noteId)
    } catch (err) {
      payload.logger.warn(`[processNote] Chroma upsert 失败: ${(err as Error).message}`)
    }

    // 6. 更新笔记
    await payload.update({
      collection: 'notes',
      id: input.noteId,
      data: {
        tags: tagsResult.output,
        isImportant: importanceResult.output.important,
        importanceReason: importanceResult.output.reason,
        aiProcessed: true,
        vectorized,
        ...(chromaId ? { chromaId } : {}),
      },
      req,
      overrideAccess: true,
    })

    payload.logger.info(
      `[processNote] note=${input.noteId} tags=${tagsResult.output.join(',')} ` +
      `important=${importanceResult.output.important} vectorized=${vectorized}`,
    )

    return {
      output: {
        tags: tagsResult.output,
        important: importanceResult.output.important,
        vectorized,
      },
    }
  },
}
