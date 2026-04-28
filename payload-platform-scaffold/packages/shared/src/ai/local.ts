/**
 * 本地嵌入模型 provider（dev 默认）
 *
 * 使用 @xenova/transformers 在 Node 进程内运行 ONNX 模型，零外部依赖、零 API key。
 * 默认模型：Xenova/all-MiniLM-L6-v2（~25MB，384 维，多语言效果一般，英文质量好；
 *                                    首次运行时自动下载到 ~/.cache/huggingface）
 *
 * 也可以用：
 *   - Xenova/multilingual-e5-small        118MB, 384 维, 中英都不错
 *   - Xenova/paraphrase-multilingual-MiniLM-L12-v2  118MB, 384 维, 多语言
 *   - Xenova/bge-small-en-v1.5            34MB, 384 维, 英文效果好
 *
 * 通过 modelId 字段指定，例如 "Xenova/multilingual-e5-small"。
 */

let extractorCache: Map<string, any> = new Map()

interface PipelineOpts {
  pooling?: 'mean' | 'cls'
  normalize?: boolean
}

async function getExtractor(modelId: string): Promise<any> {
  if (extractorCache.has(modelId)) return extractorCache.get(modelId)
  const { pipeline, env } = await import('@xenova/transformers')
  // Node 端默认会用本地缓存，下面这行确保不去尝试加载浏览器 IndexedDB
  ;(env as { useBrowserCache?: boolean }).useBrowserCache = false
  const ex = await pipeline('feature-extraction', modelId)
  extractorCache.set(modelId, ex)
  return ex
}

export async function localEmbed(
  modelId: string,
  input: string | string[],
  opts: PipelineOpts = {},
): Promise<{ embeddings: number[][]; totalTokens?: number }> {
  const inputs = Array.isArray(input) ? input : [input]
  const ex = await getExtractor(modelId || 'Xenova/all-MiniLM-L6-v2')
  const out = await ex(inputs, {
    pooling: opts.pooling ?? 'mean',
    normalize: opts.normalize ?? true,
  })
  // out 是 Tensor，dims = [N, D]，data = Float32Array(N*D)
  const dims = (out as { dims: number[] }).dims
  const data = (out as { data: Float32Array }).data
  const N = dims[0]
  const D = dims[1]
  const embeddings: number[][] = []
  for (let i = 0; i < N; i++) {
    const row = new Array<number>(D)
    for (let j = 0; j < D; j++) row[j] = data[i * D + j]
    embeddings.push(row)
  }
  return { embeddings }
}

/** 维度推断（不下载模型，仅作硬编码 fallback） */
export function localEmbedDim(modelId: string): number {
  if (modelId.includes('MiniLM-L6')) return 384
  if (modelId.includes('multilingual-e5-small')) return 384
  if (modelId.includes('bge-small')) return 384
  if (modelId.includes('bge-base')) return 768
  if (modelId.includes('multilingual-e5-base')) return 768
  return 384
}
