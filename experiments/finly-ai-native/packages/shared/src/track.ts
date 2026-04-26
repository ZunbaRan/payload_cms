import type { Payload } from 'payload'
import type { AiCallResult } from './ai'

/**
 * trackUsage — Token 用量追踪工具
 *
 * 将 AI 调用结果写入 TokenUsage Collection，
 * 与 Finly 的 onFinish 回调模式一致。
 *
 * 用法：
 *   const result = await generateTags(title, content, config)
 *   await trackUsage(payload, {
 *     result,
 *     modelId: config?.modelId || aiCfg.modelId,
 *     scene: 'generateTags',
 *     relatedNote: noteId,
 *   })
 */
export interface TrackUsageOptions {
  result: AiCallResult<unknown>
  modelId: string
  scene: 'generateTags' | 'classifyImportance' | 'summarizeDocument' | 'semanticSearch' | 'other'
  relatedNote?: string | number
  error?: string
}

export async function trackUsage(
  payload: Payload,
  options: TrackUsageOptions,
): Promise<void> {
  const { result, modelId, scene, relatedNote, error } = options
  try {
    await payload.create({
      collection: 'token-usages',
      data: {
        modelId,
        scene,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        messages: result.messages,
        ...(relatedNote ? { relatedNote } : {}),
        ...(error ? { error: error.slice(0, 200) } : {}),
      },
      overrideAccess: true,
    })
  } catch (err) {
    // 追踪失败不影响主流程
    payload.logger.warn(`[trackUsage] 写入失败: ${(err as Error).message}`)
  }
}
