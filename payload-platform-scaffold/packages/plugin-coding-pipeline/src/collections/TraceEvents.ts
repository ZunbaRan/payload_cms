import type { CollectionConfig } from 'payload'

/** PipelineTracer 原始事件流（细粒度，便于回放） */
export const TraceEvents: CollectionConfig = {
  slug: 'pipeline-trace-events',
  admin: { group: 'Coding Pipeline · Execution',
    defaultColumns: ['invocation', 'type', 'elapsedMs'] },
  fields: [
    { name: 'invocation', type: 'relationship', relationTo: 'pipeline-agent-invocations', required: true },
    { name: 'type', type: 'select', required: true,
      options: [
        'system_init', 'assistant_text', 'tool_call', 'tool_result',
        'tool_progress', 'result', 'process_cleanup', 'unknown',
      ] },
    { name: 'elapsedMs', type: 'number' },
    { name: 'data', type: 'json' },
  ],
}
