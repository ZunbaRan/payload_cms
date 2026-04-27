/**
 * @fileoverview Simple parallel execution engine for independent tasks.
 *
 * Unlike `runTeam` (which handles DAGs, shared memory, and coordination),
 * this engine simply runs a batch of independent tasks concurrently and
 * concatenates their results into a Markdown report.
 *
 * Usage:
 *   const report = await runParallel([
 *     { id: "Search A", prompt: "Search for..." },
 *     { id: "Search B", prompt: "Search for..." }
 *   ], { maxConcurrency: 4 });
 */

import { ClaudeAgent } from "../agent/claude-agent.js";
import type { ClaudeAgentOptions } from "../agent/claude-agent.js";
import type { AgentConfig, AgentRunResult } from "../shared-types.js";

export interface ParallelTask {
  /** Unique identifier for this task (becomes the Markdown heading) */
  id: string;
  /** The prompt/goal for this specific agent */
  prompt: string;
  /** Optional per-task agent configuration overrides */
  agentConfig?: Partial<AgentConfig>;
}

export interface RunParallelOptions extends ClaudeAgentOptions {
  /** Maximum number of concurrent tasks (default: unlimited/all at once) */
  maxConcurrency?: number;
  /** Default model to use if not specified in task config */
  defaultModel?: string;
  /** Abort signal to cancel execution */
  abortSignal?: AbortSignal;
  /** Callback for progress events */
  onProgress?: (event: { type: string; taskId: string; detail?: string }) => void;
}

export interface RunParallelOptions {
  /** Maximum number of concurrent tasks (default: unlimited/all at once) */
  maxConcurrency?: number;
  /** Default model to use if not specified in task config */
  defaultModel?: string;
  /** Abort signal to cancel execution */
  abortSignal?: AbortSignal;
  /** Callback for progress events */
  onProgress?: (event: { type: string; taskId: string; detail?: string }) => void;
}

/**
 * Run a list of independent tasks in parallel and concatenate results.
 */
export async function runParallel(
  tasks: ParallelTask[],
  options: RunParallelOptions = {},
): Promise<string> {
  if (tasks.length === 0) {
    return "";
  }

  const { maxConcurrency = tasks.length, defaultModel, abortSignal, onProgress } = options;

  // Validate tasks
  if (tasks.some(t => !t.id)) {
    throw new Error("All parallel tasks must have a non-empty 'id'.");
  }
  if (tasks.some(t => !t.prompt)) {
    throw new Error("All parallel tasks must have a non-empty 'prompt'.");
  }

  const results: Array<{ id: string; result: AgentRunResult | null; error?: string }> = [];

  // Simple chunk-based concurrency
  for (let i = 0; i < tasks.length; i += maxConcurrency) {
    // Check abort signal before starting a new batch
    if (abortSignal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }

    const batch = tasks.slice(i, i + maxConcurrency);
    const batchPromises = batch.map(async (task) => {
      // Extract sdkOptions by omitting runParallel-specific fields
      const { maxConcurrency: _, defaultModel: __, abortSignal: ___, onProgress: ____, ...sdkOptions } = options;

      const agentConfig: AgentConfig = {
        name: `parallel-${task.id}`,
        model: defaultModel ?? '',
        ...task.agentConfig,
      };
      const agent = new ClaudeAgent(agentConfig, sdkOptions);

      try {
        onProgress?.({ type: "task_start", taskId: task.id });
        const result = await agent.run(task.prompt);
        onProgress?.({ type: "task_complete", taskId: task.id, detail: `tokens=${result.tokenUsage.output_tokens}` });
        return { id: task.id, result, error: undefined };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        onProgress?.({ type: "task_error", taskId: task.id, detail: errorMsg });
        return { id: task.id, result: null, error: errorMsg };
      }
    });

    // Wait for all tasks in the current batch to complete
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Concatenate results into Markdown
  const markdownParts: string[] = [];
  for (const item of results) {
    markdownParts.push(`## ${item.id}`);
    if (item.result) {
      markdownParts.push(item.result.output);
    } else {
      markdownParts.push(`⚠️ **Task Failed**: ${item.error || "Unknown error"}`);
    }
    markdownParts.push("---"); // Separator
  }

  return markdownParts.join("\n\n");
}
