/**
 * @fileoverview Claude Agent SDK 增强版 Agent 类
 *
 * 基于官方 Claude Agent SDK 构建，提供更强大的 Agent 实现：
 * - 内置工具执行（无需手动实现 tool loop）
 * - 会话持久化与恢复
 * - 文件检查点与回滚
 * - MCP 服务器集成
 * - SubAgent 子代理支持
 * - 权限控制与审批流
 * - Hooks 生命周期钩子
 * - 结构化输出
 * - 预算与速率限制
 *
 * @example
 * ```ts
 * import { ClaudeAgent } from './claude-agent.js'
 *
 * const agent = new ClaudeAgent({
 *   name: 'developer',
 *   model: 'claude-sonnet-4-6',
 *   systemPrompt: 'You are a TypeScript expert.',
 *   tools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep'],
 *   permissionMode: 'acceptEdits',
 * })
 *
 * const result = await agent.query('Refactor the code in src/ to use async/await')
 * console.log(result.output)
 * ```
 */

import type {
  AgentConfig,
  AgentState,
  AgentRunResult,
  BeforeRunHookContext,
  LLMMessage,
  TextBlock,
  TokenUsage,
  ToolUseContext,
} from "../shared-types.js";
import type { ClaudeAgentConfig } from "../types.js";
import type { ToolDefinition as FrameworkToolDefinition } from "../shared-types.js";
import {
  extractJSON,
  validateOutput,
} from "./structured-output.js";
import type { ZodSchema } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import process from "node:process";
import { snapshotListeningPIDs, killNewPIDs } from "./process-cleanup.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// ============================================================================
// .env 加载工具
// ============================================================================

/**
 * 从当前工作目录加载 .env 文件
 * 格式: KEY=VALUE（每行一个，跳过空行和注释）
 */
function loadEnvFromCwd(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};

  const result: Record<string, string> = {};
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && value) {
      result[key] = value;
      // 只设置尚未存在的环境变量
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
  return result;
}

// 模块加载时立即执行（确保后续代码能读到环境变量）
loadEnvFromCwd();

// ============================================================================
// SDK 环境变量构建与清理
// ============================================================================

/**
 * 构建干净的 SDK 环境变量
 *
 * 从 process.env 出发，清理所有 ANTHROPIC_* 残留变量，
 * 然后注入指定的认证、模型、base URL 等配置。
 * 防止 ~/.claude/settings.json 或残留环境变量干扰。
 */
function buildSdkEnv(params: {
  baseEnv?: Record<string, string | undefined>;
  authToken?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };

  // 清理所有 ANTHROPIC_* 变量，防止残留配置干扰
  for (const key of Object.keys(env)) {
    if (key.startsWith("ANTHROPIC_")) {
      delete env[key];
    }
  }

  // 注入认证（优先级: authToken > apiKey）
  if (params.authToken) {
    env.ANTHROPIC_AUTH_TOKEN = params.authToken;
    env.ANTHROPIC_API_KEY = ""; // 显式清空，避免冲突
  } else if (params.apiKey) {
    env.ANTHROPIC_API_KEY = params.apiKey;
  }

  // 注入 base URL
  if (params.baseUrl) {
    env.ANTHROPIC_BASE_URL = params.baseUrl;
  }

  // 注入模型
  if (params.model) {
    env.ANTHROPIC_MODEL = params.model;
  }

  // 合并 baseEnv 中的其他变量（但不覆盖已设置的 ANTHROPIC_* 变量）
  if (params.baseEnv) {
    for (const [key, value] of Object.entries(params.baseEnv)) {
      if (typeof value === "string" && !key.startsWith("ANTHROPIC_")) {
        env[key] = value;
      }
    }
  }

  // 防止 ~/.claude/settings.json 覆盖我们的配置
  env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = "1";

  // 确保 HOME 设置正确
  if (!env.HOME) env.HOME = os.homedir();

  // 禁用非必要流量（加速连接）
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

  return env;
}

/**
 * 清理环境变量值中的空字节和控制字符
 *
 * SDK 对某些控制字符敏感，可能导致子进程启动失败。
 */
function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      // 移除空字节和控制字符
      clean[key] = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    }
  }
  return clean;
}

// ============================================================================
// 每 Agent Skill 隔离：临时项目目录 + 符号链接
// ============================================================================

/** 用户级 skills 目录 */
const USER_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

/**
 * 为指定的 allowedSkills 创建临时「项目目录」，其中
 * `.claude/skills/<name>` 只包含白名单 skill 的符号链接。
 *
 * 配合 `settingSources: ['project']` 使用，SDK 只会扫描该目录下的 skills，
 * 从而实现上下文级隔离（非白名单 skill 不会出现在 Agent 的 system prompt 中）。
 *
 * @returns 临时项目目录的绝对路径（调用方应在 Agent 结束后清理）
 */
function createSkillIsolationDir(
  allowedSkills: string[],
  agentName: string,
): string {
  const tmpBase = path.join(
    os.tmpdir(),
    "claude-agent-skills",
    `${agentName}-${Date.now()}`,
  );
  const skillsDir = path.join(tmpBase, ".claude", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  for (const skillName of allowedSkills) {
    const src = path.join(USER_SKILLS_DIR, skillName);
    const dest = path.join(skillsDir, skillName);

    // 只链接实际存在的 skill 目录
    if (fs.existsSync(src)) {
      try {
        fs.symlinkSync(src, dest, "dir");
      } catch {
        // 如果符号链接失败（权限等），拷贝 SKILL.md 作为降级
        const skillMd = path.join(src, "SKILL.md");
        if (fs.existsSync(skillMd)) {
          fs.mkdirSync(dest, { recursive: true });
          fs.copyFileSync(skillMd, path.join(dest, "SKILL.md"));
        }
      }
    }
  }

  return tmpBase;
}

/**
 * 清理临时 skill 隔离目录
 */
function cleanupSkillIsolationDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // 清理失败不影响主流程
  }
}

// ============================================================================
// Claude Agent SDK 类型定义（从 @anthropic-ai/claude-agent-sdk 导入）
// ============================================================================

// ---- Hook 类型定义（与 SDK @anthropic-ai/claude-agent-sdk 对齐）----

/**
 * SDK 支持的 Hook 事件名称
 * 完整文档：https://platform.claude.com/docs/en/agent-sdk/hooks
 */
export type HookEvent =
  | "PreToolUse"       // 工具调用前（可 block / modify）
  | "PostToolUse"      // 工具调用后返回结果
  | "PostToolUseFailure" // 工具调用失败
  | "Notification"     // Agent 状态通知
  | "UserPromptSubmit" // 用户 prompt 提交时（可注入上下文）
  | "SessionStart"     // Session 初始化（TS-only）
  | "SessionEnd"       // Session 结束（TS-only）
  | "Stop"             // Agent 执行停止
  | "SubagentStart"    // 子 Agent 启动
  | "SubagentStop"     // 子 Agent 结束
  | "PreCompact"       // 对话压缩前
  | "PermissionRequest" // 权限对话框触发时
  | "Setup"            // Session setup（TS-only）
  | "TeammateIdle"     // Teammate 变为空闲（TS-only）
  | "TaskCompleted"    // 后台任务完成（TS-only）
  | "ConfigChange"     // 配置文件变化（TS-only）
  | "WorktreeCreate"   // Git worktree 创建（TS-only）
  | "WorktreeRemove";  // Git worktree 移除（TS-only）

/**
 * Hook 回调函数
 * - 返回 `{}` → 允许操作继续（无修改）
 * - 返回 `{ hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason } }` → 阻止操作
 * - 返回 `{ systemMessage: "..." }` → 向 Agent 对话注入消息
 * - 返回 `{ hookSpecificOutput: { hookEventName, updatedInput: {...} } }` → 修改工具输入（PreToolUse）
 */
export type HookCallback = (
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

/**
 * Hook 配置项
 * - `matcher`：正则表达式，匹配工具名称（或 Notification 类型等）。不设则匹配所有
 * - `hooks`：一组回调函数，匹配时依次执行
 * - `timeout`：单个回调超时（秒），默认 60
 */
export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

/**
 * Plugin 配置项（本地插件）
 * Plugin 目录需包含 `.claude-plugin/plugin.json`
 * 支持内容：skills / agents / hooks / MCP servers
 */
export interface SdkPluginConfig {
  type: "local";
  /** 插件目录的绝对或相对路径 */
  path: string;
}

/**
 * Claude Agent SDK 的配置选项
 * 参考：https://platform.claude.com/docs/en/agent-sdk/typescript#options
 */
export interface ClaudeAgentOptions {
  /** Agent 名称，用于标识和日志 */
  name?: string;
  /** 使用的 Claude 模型 */
  model?: string;
  /**
   * 主线程以指定 SubAgent 身份运行。
   * Agent 名称必须在 `agents` 选项或 settings 中定义。
   * 设置后，主线程将使用该 SubAgent 的 prompt、tools、model 等配置。
   */
  agent?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 允许的工具列表（自动审批，无需用户确认） */
  allowedTools?: string[];
  /** 禁止的工具列表（优先级高于 allowedTools） */
  disallowedTools?: string[];
  /** 权限模式 */
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "dontAsk"
    | "bypassPermissions"
    | "auto";
  /** 当前工作目录 */
  cwd?: string;
  /** 最大对话轮次（tool-use round trips） */
  maxTurns?: number;
  /** 最大预算（USD） */
  maxBudgetUsd?: number;
  /** 会话 ID（用于持久化和恢复） */
  sessionId?: string;
  /** 恢复之前的会话 */
  resume?: string;
  /** 是否持久化会话到磁盘 */
  persistSession?: boolean;
  /** 自定义环境变量的 */
  env?: Record<string, string | undefined>;
  /** 调试模式 */
  debug?: boolean;
  /** 调试日志文件路径 */
  debugFile?: string;
  /** MCP 服务器配置 */
  mcpServers?: Record<string, any>;
  /** SubAgent 定义 */
  agents?: Record<string, AgentDefinition>;
  /**
   * 生命周期钩子
   *
   * 格式：{ [HookEvent]: HookCallbackMatcher[] }
   * 每项可含 `matcher`（正则，匹配工具名）和 `hooks`（回调数组）。
   *
   * @example
   * ```ts
   * hooks: {
   *   PreToolUse: [
   *     {
   *       matcher: 'Bash',          // 只拦截 Bash 工具
   *       hooks: [async (input) => {
   *         const cmd = (input.tool_input as any)?.command ?? ''
   *         if (cmd.includes('rm -rf')) {
   *           return {
   *             hookSpecificOutput: {
   *               hookEventName: 'PreToolUse',
   *               permissionDecision: 'deny',
   *               permissionDecisionReason: '禁止 rm -rf',
   *             },
   *           }
   *         }
   *         return {}  // 放行
   *       }],
   *     },
   *   ],
   *   PostToolUse: [{ hooks: [async (input) => { console.log('工具完成', input.tool_name); return {} }] }],
   * }
   * ```
   */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /**
   * 本地插件列表
   *
   * 每项指定插件目录路径（需含 `.claude-plugin/plugin.json`）。
   * 插件可提供 skills、agents、hooks、MCP servers 等扩展功能。
   *
   * @example
   * ```ts
   * plugins: [
   *   { type: 'local', path: './plugins/my-tools' },
   *   { type: 'local', path: '/abs/path/to/another-plugin' },
   * ]
   * ```
   */
  plugins?: SdkPluginConfig[];
  /** 自定义权限检查函数 */
  canUseTool?: (toolName: string, input: any) => Promise<boolean>;
  /** 结构化输出 schema（Zod） — 仅用于框架层验证，在 result 上设置 .structured */
  outputSchema?: ZodSchema;
  /**
   * SDK 原生结构化输出（显式传给 SDK outputFormat）
   * 仅在明确需要时启用：某些模型/代理会因 SDK 原生 structured-output 重试而提前失败。
   * 优先级高于 outputSchema：设置此项时 SDK 层面保证输出匹配 schema，
   * result 消息中的 structured_output 字段会被提取到 AgentRunResult.structured。
   * 与 outputSchema 不冲突：两者可同时设置，先用 SDK 保证格式，再用 Zod 验证类型。
   */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** Token 预算限制 */
  maxTokenBudget?: number;
  /** 温度参数 */
  temperature?: number;
  /** 思考配置 */
  thinking?: {
    type: "adaptive" | "enabled" | "disabled";
    budgetTokens?: number;
  };
  /** 努力程度 */
  effort?: "low" | "medium" | "high" | "max";
  /** Beta 功能列表 */
  betas?: string[];
  /** 是否包含部分消息（用于流式） */
  includePartialMessages?: boolean;
  /**  AbortController 用于取消 */
  abortController?: AbortController;
  /** 工具配置（框架兼容） */
  tools?: string[];

  // ---- File Checkpointing ----
  /**
   * 启用文件检查点追踪。
   * 开启后，SDK 会追踪 Write/Edit/NotebookEdit 工具的文件变更，
   * 可通过 rewindFiles() 回滚到任意检查点。
   */
  enableFileCheckpointing?: boolean;

  /**
   * 额外命令行参数（传给 Claude Code CLI）
   * 值为 null 表示无参数的 flag（如 { 'replay-user-messages': null }）
   */
  extraArgs?: Record<string, string | null>;

  // ---- OpenTelemetry ----
  /**
   * OpenTelemetry 可观测性配置。
   * 设置后自动注入 OTEL 环境变量到 SDK 子进程。
   *
   * @example
   * ```ts
   * otel: {
   *   endpoint: 'http://localhost:4318',
   *   serviceName: 'coding-pipeline',
   *   headers: 'Authorization=Bearer xxx',
   *   signals: ['traces', 'metrics', 'logs'],
   * }
   * ```
   */
  otel?: OtelConfig;

  // ---- Skill 配置 ----
  /**
   * 控制从文件系统加载 skills（.claude/skills/ 和 ~/.claude/skills/）
   * - 'project' → 加载 cwd/.claude/skills/
   * - 'user' → 加载 ~/.claude/skills/
   * - 不设置 → 隔离模式，不加载任何 skills（默认）
   */
  settingSources?: Array<"project" | "user" | "local">;
  /**
   * 禁止的 skill 列表（精确名称或前缀匹配，如 'web-access' 或 'lark-*'）
   * 通过 settings.permissions.deny 实现，格式为 'Skill(name)'
   */
  deniedSkills?: string[];
  /**
   * 允许的 skill 白名单（精确名称列表）
   *
   * 设置后，Agent 只能使用列表中指定的 skill，其他 skill 全部被拦截。
   * 实现机制：
   * 1. 自动创建临时项目目录，其中 .claude/skills/ 只包含指定 skill 的符号链接
   * 2. 设置 settingSources: ['project']，CWD 指向该临时目录（上下文级隔离）
   * 3. canUseTool 拦截非白名单 Skill 调用（运行时级防御）
   *
   * 优先级高于 deniedSkills（设置 allowedSkills 后 deniedSkills 被忽略）。
   * 不设此字段时行为取决于 settingSources 的值。
   */
  allowedSkills?: string[];
  /**
   * 是否禁用 MCP 工具
   */
  disableMcp?: boolean;
  /**
   * Claude Code 可执行文件路径
   */
  pathToClaudeCodeExecutable?: string;
  /**
   * 每条消息回调（用于日志记录和调试）
   */
  onMessage?: (msg: SDKMessage) => void;

  /**
   * 结构化日志事件回调（推荐用于多 Agent 并行场景）
   *
   * 设置后，内部的 console.log 输出会转为调用此回调，
   * 方便编排层统一聚合、加前缀、写文件等。
   * 未设置时保持原有 console.log 行为。
   */
  onEvent?: (event: AgentLogEvent) => void;

  /**
   * 是否在 systemPrompt 末尾自动注入网络检索规范（CDP 浏览器规范）
   *
   * 默认 `true`。对于不需要联网的纯计算 Agent（Scorer、Decider、Formatter 等），
   * 设置为 `false` 可节省 token 并减少无关提示噪音。
   */
  injectNetworkRule?: boolean;

  /**
   * 是否在每次 run() 前后自动清理新增的 TCP 监听进程。
   *
   * 启用后，run() 开始时快照所有监听 PID，结束时（含出错路径）
   * diff 并 SIGTERM 掉 agent 期间新启动的本地服务器进程。
   * 适用于对项目执行代码并可能启动 dev server 的 agent。
   */
  cleanupListeningPorts?: boolean;
}

/**
 * SubAgent MCP 服务器规格
 *
 * - string: 引用父 Agent 的 mcpServers 中的服务器名称
 * - Record<string, any>: 内联 MCP 服务器配置
 */
export type AgentMcpServerSpec = string | Record<string, any>;

/**
 * SubAgent 定义
 *
 * 参考 SDK 文档: https://code.claude.com/docs/en/agent-sdk/sub-agents
 */
export interface AgentDefinition {
  /** Agent 描述（Claude 根据此描述判断何时调用该 SubAgent） */
  description: string;
  /** 允许的工具（省略则继承父 Agent 的全部工具） */
  tools?: string[];
  /** 禁止的工具（优先级高于 tools） */
  disallowedTools?: string[];
  /** SubAgent 的系统提示词 */
  prompt: string;
  /** 模型覆盖（'sonnet' | 'opus' | 'haiku' | 'inherit'，省略则使用主 Agent 的模型） */
  model?: string;
  /** MCP 服务器配置（数组：每项为服务器名称字符串或内联配置对象） */
  mcpServers?: AgentMcpServerSpec[];
  /** 最大轮次（API round-trips） */
  maxTurns?: number;
  /** Skill 白名单 */
  skills?: string[];
  /** 实验性: 注入到系统提示词的关键提醒 */
  criticalSystemReminder_EXPERIMENTAL?: string;
}

/**
 * OpenTelemetry 可观测性配置
 */
export interface OtelConfig {
  /** OTLP Collector 端点 (e.g. "http://localhost:4318") */
  endpoint: string;
  /** 服务名称（默认 "claude-agent"） */
  serviceName?: string;
  /** OTLP 请求头 (e.g. "Authorization=Bearer xxx") */
  headers?: string;
  /** 导出的信号种类（默认全部开启） */
  signals?: Array<'traces' | 'metrics' | 'logs'>;
  /** OTLP 传输协议（默认 "http/protobuf"） */
  protocol?: string;
  /** 资源属性 (e.g. "service.version=1.0,deployment.environment=prod") */
  resourceAttributes?: string;
  /** 导出间隔（毫秒），用于短任务避免丢数据（默认不设置，使用 SDK 默认值） */
  exportIntervalMs?: number;
}

/**
 * 文件检查点回滚结果
 */
export interface RewindFilesResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

/**
 * SDK 返回的消息类型
 */
type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage;

interface SDKToolProgressMessage {
  type: "tool_progress";
  tool_name: string;
  elapsed_time_seconds: number;
}

interface SDKToolUseSummaryMessage {
  type: "tool_use_summary";
  summary: string;
}

interface SDKSystemMessage {
  type: "system";
  subtype: "init" | "error";
  /** 以下字段在 subtype='init' 时存在 */
  cwd?: string;
  session_id?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  model?: string;
  permissionMode?: string;
  slash_commands?: string[];
  apiKeySource?: string;
  claude_code_version?: string;
  output_style?: string;
  agents?: string[];
  skills?: string[];
  plugins?: Array<{ name: string; path: string; source: string }>;
  uuid?: string;
  fast_mode_state?: string;
}

interface SDKUserMessage {
  type: "user";
  message?: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
  session_id?: string;
  /** 工具执行结果 */
  tool_use_result?: unknown;
}

interface SDKAssistantMessage {
  type: "assistant";
  message: {
    id: string;
    content: Array<{
      type: "text" | "tool_use" | "tool_result" | "thinking";
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: any;
    }>;
    model: string;
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  parent_tool_use_id: string | null;
  session_id: string;
  uuid: string;
}

interface SDKResultMessage {
  type: "result";
  subtype: "success" | "error" | string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  /** 最终文本结果 */
  result?: string;
  session_id: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: {
      web_search_requests: number;
      web_fetch_requests: number;
    };
  };
  modelUsage?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }
  >;
  permission_denials?: Array<{ tool_name: string; tool_input: any }>;
  terminal_reason?: string;
  uuid: string;
}

/**
 * 结构化日志事件（替代 console.log，支持多 Agent 并行场景下的日志聚合）
 *
 * 通过 `onEvent` 选项注册，框架层可以统一收集并前缀 agentName 输出，
 * 避免多 Agent 并行时日志交错。
 */
export interface AgentLogEvent {
  /** 产生事件的 agent 名称 */
  agentName: string
  /** 事件类型 */
  type:
    | 'system_init'
    | 'assistant_text'
    | 'tool_call'
    | 'tool_result'
    | 'tool_progress'
    | 'result'
    | 'process_cleanup'
    | 'unknown'
  /** 事件 payload */
  data: Record<string, unknown>
}

/**
 * Query 返回对象（流式迭代器）
 */
interface QueryResult extends AsyncIterable<SDKMessage> {
  /** 中断查询（仅流式输入模式可用） */
  interrupt(): void;
  /** 获取初始化结果 */
  initializationResult(): Promise<InitializationResult>;
  /** 获取支持的命令 */
  supportedCommands(): Promise<any[]>;
  /** 获取支持的模型 */
  supportedModels(): Promise<any[]>;
  /** 获取可用的 SubAgent */
  supportedAgents(): Promise<AgentInfo[]>;
  /** 获取 MCP 服务器状态 */
  mcpServerStatus(): Promise<any>;
  /** 获取账户信息 */
  accountInfo(): Promise<any>;
  /** 关闭查询并清理资源 */
  close(): void;
}

interface InitializationResult {
  supportedCommands: any[];
  supportedModels: any[];
  accountInfo: any;
  sessionId: string;
}

interface AgentInfo {
  name: string;
  description: string;
  model?: string;
}

// ============================================================================
// 内部辅助函数
// ============================================================================

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 };

/**
 * 合并两个 TokenUsage
 */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

/**
 * 将 SDK 消息转换为框架消息格式
 */
function sdkMessageToLLMMessage(sdkMsg: SDKAssistantMessage): LLMMessage {
  const content: LLMMessage["content"] = [];

  for (const block of sdkMsg.message.content) {
    if (block.type === "text" && block.text) {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id ?? "",
        name: block.name ?? "",
        input: block.input ?? {},
      });
    } else if (block.type === "tool_result") {
      content.push({
        type: "tool_result",
        tool_use_id: block.id ?? "",
        content: block.text ?? "",
      });
    }
  }

  return {
    role: "assistant",
    content,
  };
}

/**
 * 从 SDK 消息中提取纯文本输出
 */
function extractOutputFromMessages(messages: SDKMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (
      msg.type === "result" &&
      "result" in msg &&
      typeof (msg as any).result === "string"
    ) {
      return (msg as any).result;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.type === "assistant" && "message" in msg) {
      const textParts: string[] = [];
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        }
      }
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }
  }

  return "";
}

function extractJsonFromSdkMessages(messages: SDKMessage[]): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!(msg.type === "assistant" && "message" in msg)) continue;

    for (const block of msg.message.content) {
      if (block.type !== "text" || !block.text) continue;
      try {
        return extractJSON(block.text);
      } catch {
        // Continue scanning earlier assistant messages.
      }
    }
  }

  throw new Error("No JSON found in SDK assistant messages");
}

function extractJsonFromStructuredOutputToolCalls(messages: SDKMessage[]): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!(msg.type === "assistant" && "message" in msg)) continue;

    for (const block of msg.message.content) {
      if (block.type !== "tool_use" || block.name !== "StructuredOutput") continue;

      const content = (block.input as Record<string, unknown> | undefined)?.content;
      if (typeof content !== "string" || content.trim() === "") continue;

      try {
        return extractJSON(content);
      } catch {
        // Continue scanning earlier StructuredOutput calls.
      }
    }
  }

  throw new Error("No JSON found in StructuredOutput tool calls");
}

/**
 * 计算总 token 使用量
 */
function calculateTotalUsage(messages: SDKMessage[]): TokenUsage {
  // Check for result message which has the final usage
  for (const msg of messages) {
    if (msg.type === "result" && "usage" in msg) {
      const usage = (msg as any).usage;
      if (usage) {
        return {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
        };
      }
    }
  }

  // Fallback: check assistant messages
  let inputTokens = 0;
  let outputTokens = 0;

  for (const msg of messages) {
    if (msg.type === "assistant" && "message" in msg) {
      const usage = msg.message.usage;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
      }
    }
  }

  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

/**
 * 从 SDK 消息列表中提取 tool call 信息
 *
 * 策略：遍历所有消息，按顺序配对：
 * - assistant 消息中的 tool_use block → 记录 toolName + input
 * - tool_progress 消息 → 更新对应 tool 的 duration
 * - user 消息中的 tool_use_result → 填充对应 tool 的 output
 */
function extractToolCallsFromMessages(
  messages: SDKMessage[],
): Array<{ toolName: string; input: Record<string, unknown>; output: string; duration: number }> {
  interface MutableCall {
    toolName: string;
    input: Record<string, unknown>;
    output: string;
    duration: number;
  }

  const calls: MutableCall[] = [];

  for (const msg of messages) {
    if (msg.type === "assistant") {
      for (const block of (msg as SDKAssistantMessage).message.content) {
        if (block.type === "tool_use") {
          calls.push({
            toolName: block.name ?? "unknown",
            input: block.input ?? {},
            output: "",
            duration: 0,
          });
        }
      }
    } else if (msg.type === "tool_progress") {
      const progressMsg = msg as SDKToolProgressMessage;
      // 更新最近一个同名且尚未记录 duration 的 call
      for (let i = calls.length - 1; i >= 0; i--) {
        if (
          calls[i]!.toolName === progressMsg.tool_name &&
          calls[i]!.duration === 0
        ) {
          calls[i]!.duration = Math.round(
            progressMsg.elapsed_time_seconds * 1000,
          );
          break;
        }
      }
    } else if (msg.type === "user") {
      const userMsg = msg as SDKUserMessage;
      if (userMsg.tool_use_result !== undefined) {
        // 填充最近一个 output 为空的 call
        for (let i = calls.length - 1; i >= 0; i--) {
          if (calls[i]!.output === "") {
            const result = userMsg.tool_use_result;
            calls[i]!.output =
              typeof result === "string"
                ? result.slice(0, 500)
                : JSON.stringify(result).slice(0, 500);
            break;
          }
        }
      }
    }
  }
  return calls;
}

// ============================================================================
// ClaudeAgent 主类
// ============================================================================

/**
 * 基于 Claude Agent SDK 的增强版 Agent 类
 *
 * 提供比原生 agent.ts 更强大的功能：
 * - 内置工具执行（Read, Edit, Bash, Glob, Grep, Write 等）
 * - 会话持久化与恢复
 * - 文件检查点与回滚
 * - MCP 服务器集成
 * - SubAgent 子代理支持
 * - 权限控制与审批流
 * - Hooks 生命周期钩子
 * - 结构化输出
 * - 预算与速率限制
 */
export class ClaudeAgent {
  readonly name: string;
  readonly config: AgentConfig | ClaudeAgentConfig;
  private readonly sdkOptions: ClaudeAgentOptions;
  /** allowedSkills 创建的临时隔离目录，Agent 结束后自动清理 */
  private _skillIsolationDir?: string;
  /** 动态追加的 MCP 服务器（不 mutate sdkOptions，独立存储，executeQuery 时合并快照） */
  private readonly _dynamicMcpServers: Record<string, unknown> = {};

  private state: AgentState;
  private messageHistory: LLMMessage[] = [];
  private sessionId?: string;
  private queryInstance?: QueryResult;
  private isInitialized = false;

  // ── File Checkpointing state ──
  /** 按时间序捕获的 checkpoint UUID（来自 user message） */
  private _checkpointIds: string[] = [];
  /** 最近一次查询的 Query 对象引用（用于 rewindFiles） */
  private _lastQuery?: QueryResult;

  /**
   * @param config - Agent 配置
   * @param sdkOptions - Claude Agent SDK 配置选项
   *
   * @example
   * ```typescript
   * // 使用自定义 API key 和 base URL
   * const agent = new ClaudeAgent(config, {
   *   env: {
   *     ANTHROPIC_API_KEY: 'sk-ant-your-key',
   *     ANTHROPIC_BASE_URL: 'https://your-custom-endpoint.com',
   *   },
   *   permissionMode: 'acceptEdits',
   * })
   * ```
   */
  constructor(config: AgentConfig | ClaudeAgentConfig, sdkOptions: ClaudeAgentOptions = {}) {
    this.name = config.name;
    this.config = config;

    // 从 .env / 环境变量读取三个核心参数（优先级：显式传入 > .env > undefined）
    const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const envAuthToken =
      process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
    const envModel = process.env.DEFAULT_MODEL;

    // 从 AgentConfig 读取显式覆盖值（优先级高于 env）
    const agentConfig = config as AgentConfig;
    const configBaseUrl = agentConfig.baseURL;
    const configApiKey = agentConfig.apiKey;

    // 构建 env 对象（合并传入的 env 和 .env 中的值）
    // 优先级: sdkOptions.env > config.baseURL/apiKey > process.env
    const resolvedEnv: Record<string, string | undefined> = {
      ...(envBaseUrl ? { ANTHROPIC_BASE_URL: envBaseUrl } : {}),
      ...(envAuthToken
        ? {
            ANTHROPIC_API_KEY: envAuthToken,
            ANTHROPIC_AUTH_TOKEN: envAuthToken,
          }
        : {}),
      ...(configBaseUrl ? { ANTHROPIC_BASE_URL: configBaseUrl } : {}),
      ...(configApiKey
        ? { ANTHROPIC_API_KEY: configApiKey, ANTHROPIC_AUTH_TOKEN: configApiKey }
        : {}),
      ...(sdkOptions.env ?? {}),
    };

    this.sdkOptions = {
      ...sdkOptions,
      name: config.name,
      model: config.model || sdkOptions.model || envModel,
      systemPrompt: config.systemPrompt,
      env: resolvedEnv,
      pathToClaudeCodeExecutable: sdkOptions.pathToClaudeCodeExecutable,
      allowedTools: (config as AgentConfig).tools
        ? [...(config as AgentConfig).tools!]
        : sdkOptions.allowedTools,
      maxTurns: config.maxTurns ?? sdkOptions.maxTurns,
      outputSchema: config.outputSchema ?? sdkOptions.outputSchema,
      outputFormat: sdkOptions.outputFormat,
      maxTokenBudget: (config as AgentConfig).maxTokenBudget ?? sdkOptions.maxTokenBudget,
      timeoutMs: config.timeoutMs ?? sdkOptions.timeoutMs,
      temperature: (config as AgentConfig).temperature ?? sdkOptions.temperature,
    };

    this.state = {
      status: "idle",
      messages: [],
      tokenUsage: ZERO_USAGE,
    };
  }

  // ==========================================================================
  // 初始化与清理
  // ==========================================================================

  /**
   * 初始化 Agent（延迟加载）
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;

    // 这里应该初始化 Claude Agent SDK
    // 由于需要动态导入 @anthropic-ai/claude-agent-sdk
    // 实际实现中需要处理异步导入

    this.isInitialized = true;
  }

  /**
   * 重置 Agent 状态和会话
   */
  reset(): void {
    this.messageHistory = [];
    this.sessionId = undefined;
    this.queryInstance?.close();
    this.queryInstance = undefined;
    this.isInitialized = false;
    // 清理 allowedSkills 临时隔离目录
    this.cleanupSkillIsolation();
    this.state = {
      status: "idle",
      messages: [],
      tokenUsage: ZERO_USAGE,
    };
  }

  /** 清理 allowedSkills 创建的临时隔离目录 */
  private cleanupSkillIsolation(): void {
    if (this._skillIsolationDir) {
      cleanupSkillIsolationDir(this._skillIsolationDir);
      this._skillIsolationDir = undefined;
    }
  }

  // ==========================================================================
  // 主要执行方法
  // ==========================================================================

  /**
   * 运行单次查询（不使用历史对话）
   *
   * @param prompt - 用户提示词
   * @param options - 可选配置。支持传入运行时 `signal` 用于外部取消（编排层传入），
   *   无需在构造时固定 AbortController。
   * @returns Agent 运行结果
   */
  async run(
    prompt: string,
    options?: Partial<ClaudeAgentOptions> & { signal?: AbortSignal },
  ): Promise<AgentRunResult> {
    await this.ensureInitialized();

    const messages: LLMMessage[] = [
      { role: "user", content: [{ type: "text", text: prompt }] },
    ];

    // 将运行时 signal 包装为 AbortController 传给 SDK
    const runtimeOptions: Partial<ClaudeAgentOptions> | undefined =
      options?.signal
        ? {
            ...options,
            abortController: (() => {
              const ctrl = new AbortController();
              options.signal!.addEventListener("abort", () => ctrl.abort());
              return ctrl;
            })(),
          }
        : options;

    // 若启用 cleanupListeningPorts，在 run 前后做本地监听进程 diff 并清理
    if (this.sdkOptions.cleanupListeningPorts) {
      const emitCleanup = (message: string) => {
        this.sdkOptions.onEvent?.({ agentName: this.name, type: 'process_cleanup', data: { message } })
          ?? console.log(message);
      };
      const beforePIDs = snapshotListeningPIDs();
      emitCleanup(`🔌 pre-run: ${beforePIDs.size} listening PID(s)`);
      try {
        return await this.executeRun(messages, runtimeOptions);
      } finally {
        const afterPIDs = snapshotListeningPIDs();
        const newPIDs = [...afterPIDs].filter(p => !beforePIDs.has(p));
        if (newPIDs.length > 0) {
          killNewPIDs(this.name, newPIDs, emitCleanup);
        } else {
          emitCleanup('🔌 post-run: no new listening PIDs');
        }
      }
    }

    return this.executeRun(messages, runtimeOptions);
  }

  /**
   * 作为持续对话的一部分运行（使用历史对话）
   *
   * @param message - 用户消息
   * @returns Agent 运行结果
   */
  async prompt(message: string): Promise<AgentRunResult> {
    await this.ensureInitialized();

    const userMessage: LLMMessage = {
      role: "user",
      content: [{ type: "text", text: message }],
    };

    this.messageHistory.push(userMessage);

    const result = await this.executeRun([...this.messageHistory]);

    // 持久化新消息到历史对话
    for (const msg of result.messages) {
      this.messageHistory.push(msg);
    }

    return result;
  }

  /**
   * 使用 SubAgent 执行任务（编程式调用）
   *
   * 创建一个独立的 ClaudeAgent 实例来执行任务，实现完整的上下文隔离：
   * - SubAgent 运行在全新的会话中（不继承父 Agent 的对话历史）
   * - 使用 SubAgent 定义中的 tools、model、maxTurns 等配置
   * - 仅返回最终输出，中间 tool call 不会污染父 Agent 上下文
   *
   * 注意：这是编程式调用方式。在 Agent 对话循环中，SDK 会通过
   * Agent 工具自动调用 SubAgent，无需手动调用此方法。
   *
   * @param agentName - SubAgent 名称（必须在 agents 选项中定义）
   * @param task - 任务描述（传递给 SubAgent 的 prompt）
   * @returns SubAgent 运行结果
   */
  async runSubAgent(agentName: string, task: string): Promise<AgentRunResult> {
    await this.ensureInitialized();

    // 检查是否定义了该 SubAgent
    const agentDef = this.sdkOptions.agents?.[agentName];
    if (!agentDef) {
      const available = Object.keys(this.sdkOptions.agents ?? {}).join(", ") || "(none)";
      throw new Error(
        `SubAgent "${agentName}" is not defined. Available: ${available}`,
      );
    }

    // 构建 SubAgent 配置（继承父 Agent 的共享设置，应用 SubAgent 特有设置）
    const parentOpts = this.sdkOptions;
    const subConfig: AgentConfig = {
      name: agentName,
      model: agentDef.model ?? parentOpts.model ?? "sonnet",
      systemPrompt: agentDef.prompt,
    };

    const subSdkOptions: ClaudeAgentOptions = {
      // 共享设置（从父 Agent 继承）
      cwd: parentOpts.cwd,
      env: parentOpts.env,
      settingSources: parentOpts.settingSources,
      permissionMode: parentOpts.permissionMode ?? "bypassPermissions",
      pathToClaudeCodeExecutable: parentOpts.pathToClaudeCodeExecutable,
      persistSession: false, // SubAgent 不需要持久化会话
      injectNetworkRule: parentOpts.injectNetworkRule,
      // SubAgent 特有设置（覆盖父 Agent）
      model: agentDef.model ?? parentOpts.model,
      systemPrompt: agentDef.prompt,
      allowedTools: agentDef.tools ?? parentOpts.allowedTools,
      disallowedTools: agentDef.disallowedTools,
      maxTurns: agentDef.maxTurns ?? parentOpts.maxTurns,
      // mcpServers: SubAgent 可引用父 Agent 的 MCP 或自带配置
      mcpServers: this.resolveSubAgentMcpServers(agentDef, parentOpts),
      // skills
      allowedSkills: agentDef.skills,
      // SubAgent 不能再嵌套 SubAgent
      // agents: undefined,
      // 日志回调继承
      onMessage: parentOpts.onMessage,
      onEvent: parentOpts.onEvent,
    };

    // 创建独立的 ClaudeAgent 实例
    const subAgent = new ClaudeAgent(subConfig, subSdkOptions);

    // 执行任务并返回结果
    return subAgent.run(task);
  }

  /**
   * 解析 SubAgent 的 MCP 服务器配置
   *
   * AgentMcpServerSpec[] 中每项可以是：
   * - string: 引用父 Agent 的 mcpServers 中的服务器名称
   * - Record<string, any>: 内联 MCP 服务器配置
   */
  private resolveSubAgentMcpServers(
    agentDef: AgentDefinition,
    parentOpts: ClaudeAgentOptions,
  ): Record<string, any> | undefined {
    if (!agentDef.mcpServers || agentDef.mcpServers.length === 0) {
      return undefined;
    }

    const resolved: Record<string, any> = {};
    for (const spec of agentDef.mcpServers) {
      if (typeof spec === "string") {
        // 引用父 Agent 的 MCP 服务器
        const parentServer = parentOpts.mcpServers?.[spec];
        if (parentServer) {
          resolved[spec] = parentServer;
        }
      } else {
        // 内联配置
        Object.assign(resolved, spec);
      }
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }

  // ==========================================================================
  // 会话管理
  // ==========================================================================

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * 恢复到之前的会话
   *
   * @param sessionId - 会话 ID
   */
  async resumeSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.sdkOptions.resume = sessionId;
    await this.ensureInitialized();
  }

  /**
   * 获取会话历史消息
   */
  getHistory(): LLMMessage[] {
    return [...this.messageHistory];
  }

  /**
   * 获取当前状态快照
   */
  getState(): AgentState {
    return { ...this.state, messages: [...this.state.messages] };
  }

  // ==========================================================================
  // 工具管理
  // ==========================================================================

  /**
   * 动态注册工具
   *
   * @param tool - 工具定义
   */
  addTool(tool: FrameworkToolDefinition): void {
    // Claude Agent SDK 不支持动态注册自定义工具
    // 工具需要通过 MCP 服务器或内置工具提供
    console.warn(
      "ClaudeAgent: addTool is not supported. Use MCP servers for custom tools.",
    );
  }

  /**
   * 获取支持的 SubAgent 列表
   */
  async getSupportedAgents(): Promise<AgentInfo[]> {
    await this.ensureInitialized();
    return this.queryInstance?.supportedAgents() ?? [];
  }

  /**
   * 获取支持的模型列表
   */
  async getSupportedModels(): Promise<any[]> {
    await this.ensureInitialized();
    return this.queryInstance?.supportedModels() ?? [];
  }

  /**
   * 获取账户信息
   */
  async getAccountInfo(): Promise<any> {
    await this.ensureInitialized();
    return this.queryInstance?.accountInfo();
  }

  /**
   * 移除工具
   *
   * @param name - 工具名称
   */
  removeTool(name: string): void {
    // Claude Agent SDK 不支持动态移除工具
    console.warn("ClaudeAgent: removeTool is not supported.");
  }

  /**
   * 获取当前工具列表
   */
  getTools(): string[] {
    // 返回配置的工具列表
    return this.sdkOptions.allowedTools ?? [];
  }

  // ==========================================================================
  // MCP 服务器管理
  // ==========================================================================

  /**
   * 添加 MCP 服务器
   *
   * 不 mutate 构造时的 sdkOptions，变更存储在独立字段，
   * 在下次 executeQuery 时合并为快照传给 SDK。
   *
   * @param name - 服务器名称
   * @param config - 服务器配置
   */
  addMCPServer(name: string, config: unknown): void {
    this._dynamicMcpServers[name] = config;
  }

  /**
   * 移除 MCP 服务器
   *
   * @param name - 服务器名称
   */
  removeMCPServer(name: string): void {
    delete this._dynamicMcpServers[name];
  }

  /**
   * 获取 MCP 服务器状态
   */
  async getMCPServerStatus(): Promise<any> {
    await this.ensureInitialized();
    return this.queryInstance?.mcpServerStatus();
  }

  // ==========================================================================
  // 文件检查点（File Checkpointing）
  // ==========================================================================

  /**
   * 获取所有捕获的 checkpoint UUID（按时间序）
   */
  getCheckpointIds(): string[] {
    return [...this._checkpointIds];
  }

  /**
   * 获取最早的 checkpoint UUID（回滚到初始状态）
   */
  getFirstCheckpointId(): string | undefined {
    return this._checkpointIds[0];
  }

  /**
   * 获取最后一个 checkpoint UUID（回滚到最近安全状态）
   */
  getLastCheckpointId(): string | undefined {
    return this._checkpointIds[this._checkpointIds.length - 1];
  }

  /**
   * 回滚文件到指定 checkpoint 的状态
   *
   * 需要在构造时设置 `enableFileCheckpointing: true`。
   * 回滚只影响磁盘文件（Write/Edit/NotebookEdit 的变更），不影响对话历史。
   *
   * 实现策略：恢复之前的 session，发送空 prompt 打开连接，然后调用 rewindFiles。
   *
   * @param checkpointId - checkpoint UUID（来自 user message）
   * @param dryRun - 如果为 true，只预览变更不实际执行
   * @returns 回滚结果（包含变更文件列表等）
   */
  async rewindFiles(checkpointId: string, dryRun?: boolean): Promise<RewindFilesResult> {
    if (!this.sdkOptions.enableFileCheckpointing) {
      return { canRewind: false, error: 'enableFileCheckpointing is not enabled' };
    }
    if (!this.sessionId) {
      return { canRewind: false, error: 'No session ID available — agent has not run yet' };
    }

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      // 恢复 session + 空 prompt 打开连接
      const rewindQuery = query({
        prompt: "",
        options: {
          enableFileCheckpointing: true,
          resume: this.sessionId,
          env: this.sdkOptions.env as Record<string, string>,
          permissionMode: this.sdkOptions.permissionMode ?? 'bypassPermissions',
          ...(this.sdkOptions.permissionMode === 'bypassPermissions'
            ? { allowDangerouslySkipPermissions: true }
            : {}),
        },
      });

      // 消费第一条消息后立即 rewind
      for await (const _msg of rewindQuery) {
        const result = await (rewindQuery as any).rewindFiles(checkpointId, { dryRun });
        return result as RewindFilesResult;
      }

      return { canRewind: false, error: 'Stream ended before rewind could execute' };
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ==========================================================================
  // 权限控制
  // ==========================================================================

  /**
   * 动态修改权限模式
   *
   * @param mode - 权限模式
   */
  setPermissionMode(mode: ClaudeAgentOptions["permissionMode"]): void {
    this.sdkOptions.permissionMode = mode;
  }

  /**
   * 设置自定义权限检查函数
   *
   * @param canUseTool - 权限检查函数
   */
  setCanUseTool(canUseTool: ClaudeAgentOptions["canUseTool"]): void {
    this.sdkOptions.canUseTool = canUseTool;
  }

  /**
   * 格式化打印 SDK 消息（区分不同类型）
   * 参考 claude-delegate-runner.mjs 的日志格式化逻辑
   */
  private prettyPrintSdkMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case "system":
        this.printSystemMessage(msg);
        break;

      case "assistant":
        this.printAssistantMessage(msg);
        break;

      case "user":
        this.printUserMessage(msg);
        break;

      case "result":
        this.printResultMessage(msg);
        break;

      case "tool_progress":
        this.printToolProgressMessage(msg);
        break;

      case "tool_use_summary":
        this.printToolUseSummaryMessage(msg);
        break;

      default:
        // 未知消息类型
        console.log(`[SDK] unknown message type: ${(msg as any).type}`, msg);
    }
  }

  /**
   * 将 SDK 消息转为结构化 AgentLogEvent 并分发到 onEvent 回调
   *
   * 当注册了 onEvent 时，用此方法替代 prettyPrintSdkMessage，
   * 编排层可按 agentName 聚合，避免多 Agent 并行时日志交错。
   */
  private dispatchLogEvent(msg: SDKMessage): void {
    const { onEvent } = this.sdkOptions;
    if (!onEvent) return;

    let type: AgentLogEvent["type"] = "unknown";
    const data: Record<string, unknown> = {};

    switch (msg.type) {
      case "system": {
        type = "system_init";
        const s = msg as SDKSystemMessage;
        data.subtype = s.subtype;
        data.model = s.model;
        data.session_id = s.session_id;
        data.tools = s.tools;
        data.skills = s.skills;
        data.mcp_servers = s.mcp_servers;
        data.slash_commands = s.slash_commands;
        data.plugins = (s.plugins ?? []).map((p: any) => p.name);
        break;
      }
      case "assistant": {
        const a = msg as SDKAssistantMessage;
        for (const block of a.message.content) {
          if (block.type === "text" && block.text?.trim()) {
            type = "assistant_text";
            data.text = block.text;
          } else if (block.type === "tool_use") {
            type = "tool_call";
            data.tool_name = block.name;
            data.tool_id = block.id;
            data.input = block.input;
          }
        }
        break;
      }
      case "user": {
        const u = msg as SDKUserMessage;
        if (u.tool_use_result !== undefined) {
          type = "tool_result";
          data.parent_tool_use_id = u.parent_tool_use_id;
          data.result =
            typeof u.tool_use_result === "string"
              ? u.tool_use_result.slice(0, 200)
              : JSON.stringify(u.tool_use_result).slice(0, 200);
        }
        break;
      }
      case "tool_progress": {
        type = "tool_progress";
        const p = msg as SDKToolProgressMessage;
        data.tool_name = p.tool_name;
        data.elapsed_seconds = p.elapsed_time_seconds;
        break;
      }
      case "result": {
        type = "result";
        const r = msg as SDKResultMessage;
        data.subtype = r.subtype;
        data.is_error = r.is_error;
        data.num_turns = r.num_turns;
        data.duration_ms = r.duration_ms;
        data.cost_usd = r.total_cost_usd;
        data.input_tokens = r.usage?.input_tokens;
        data.output_tokens = r.usage?.output_tokens;
        break;
      }
    }

    onEvent({ agentName: this.name, type, data });
  }

  /**
   * 打印系统初始化消息
   */
  private printSystemMessage(msg: SDKSystemMessage): void {
    if (msg.subtype === "init") {
      const initMsg = [
        "═══ System Init ═══",
        `  model:            ${msg.model ?? "(default)"}`,
        `  permission_mode:  ${msg.permissionMode ?? "default"}`,
        `  session_id:       ${msg.session_id ?? ""}`,
        `  tools (${(msg.tools ?? []).length}):           ${(msg.tools ?? []).join(", ")}`,
        `  skills (${(msg.skills ?? []).length}):         ${(msg.skills ?? []).slice(0, 8).join(", ")}${(msg.skills ?? []).length > 8 ? " ..." : ""}`,
        `  agents:           ${(msg.agents ?? []).join(", ")}`,
        `  mcp_servers:      ${(msg.mcp_servers ?? []).map((s: any) => s.name).join(", ") || "(none)"}`,
        `  plugins:          ${(msg.plugins ?? []).map((p: any) => p.name).join(", ") || "(none)"}`,
      ];
      console.log(initMsg.join("\n"));
      console.log("");
    }
  }

  /**
   * 打印助手消息（区分 text / tool_use / thinking）
   */
  private printAssistantMessage(msg: SDKAssistantMessage): void {
    if (!Array.isArray(msg.message?.content)) return;

    for (const block of msg.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        console.log(`━━━ Assistant Text ━━━`);
        console.log(block.text);
        console.log("");
      } else if (block.type === "tool_use") {
        console.log(`━━━ Tool Call ━━━`);
        console.log(`  tool:  ${block.name ?? "unknown"}`);
        console.log(`  id:    ${block.id ?? "unknown"}`);
        if (block.input && Object.keys(block.input).length > 0) {
          console.log(
            `  input: ${JSON.stringify(block.input, null, 2).slice(0, 200)}`,
          );
        }
        console.log("");
      } else if (block.type === "thinking" && block.thinking) {
        console.log(`━━━ Thinking ━━━`);
        console.log(block.thinking.slice(0, 500));
        if (block.thinking.length > 500) console.log("  ... (truncated)");
        console.log("");
      }
    }
  }

  /**
   * 打印用户消息（通常是 tool result）
   */
  private printUserMessage(msg: SDKUserMessage): void {
    if (msg.tool_use_result !== undefined) {
      const result = msg.tool_use_result;
      const content =
        typeof result === "string"
          ? result
          : JSON.stringify(result).slice(0, 200);
      console.log(`━━━ Tool Result ━━━`);
      console.log(
        `  parent_tool_use_id: ${msg.parent_tool_use_id ?? "unknown"}`,
      );
      console.log(`  content: ${content}`);
      console.log("");
    }
  }

  /**
   * 打印结果消息
   */
  private printResultMessage(msg: SDKResultMessage): void {
    console.log(`═══ Result ═══`);
    console.log(`  subtype:         ${msg.subtype}`);
    console.log(`  is_error:        ${msg.is_error}`);
    console.log(`  num_turns:       ${msg.num_turns}`);
    console.log(`  duration_ms:     ${msg.duration_ms}`);
    console.log(`  duration_api_ms: ${msg.duration_api_ms}`);
    console.log(`  total_cost_usd:  ${msg.total_cost_usd?.toFixed(4)}`);
    if (msg.usage) {
      console.log(`  input_tokens:    ${msg.usage.input_tokens ?? 0}`);
      console.log(`  output_tokens:   ${msg.usage.output_tokens ?? 0}`);
      console.log(
        `  cache_read:      ${msg.usage.cache_read_input_tokens ?? 0}`,
      );
      console.log(
        `  cache_creation:  ${msg.usage.cache_creation_input_tokens ?? 0}`,
      );
    }
    if (msg.result) {
      const text =
        typeof msg.result === "string"
          ? msg.result
          : JSON.stringify(msg.result);
      console.log(
        `  result:          ${text.slice(0, 300)}${text.length > 300 ? " ..." : ""}`,
      );
    }
    if (msg.modelUsage) {
      for (const [model, usage] of Object.entries(msg.modelUsage)) {
        console.log(`  model (${model}):`);
        console.log(`    input:  ${(usage as any).inputTokens ?? 0}`);
        console.log(`    output: ${(usage as any).outputTokens ?? 0}`);
        console.log(`    cost:   $${(usage as any).costUSD ?? 0}`);
      }
    }
    console.log("");
  }

  /**
   * 打印工具进度消息
   */
  private printToolProgressMessage(msg: any): void {
    console.log(`━━━ Tool Progress ━━━`);
    console.log(`  tool_name:             ${msg.tool_name ?? "unknown"}`);
    console.log(`  elapsed_time_seconds:  ${msg.elapsed_time_seconds ?? 0}`);
    console.log("");
  }

  /**
   * 打印工具使用摘要
   */
  private printToolUseSummaryMessage(msg: any): void {
    console.log(`━━━ Tool Use Summary ━━━`);
    console.log(`  summary: ${msg.summary?.slice(0, 200) ?? "(none)"}`);
    console.log("");
  }

  // ==========================================================================
  // 私有执行核心
  // ==========================================================================

  /**
   * 执行运行的核心逻辑
   */
  private async executeRun(
    messages: LLMMessage[],
    callerOptions?: Partial<ClaudeAgentOptions>,
  ): Promise<AgentRunResult> {
    this.transitionTo("running");

    const agentStartMs = Date.now();
    let stage = "executeRun:start";

    try {
      // --- beforeRun hook ---
      if (this.config.beforeRun) {
        stage = "beforeRun:before";
        const hookCtx = this.buildBeforeRunHookContext(messages);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const modified = await (this.config.beforeRun as any)(hookCtx);
        stage = "beforeRun:after";
        this.applyHookContext(messages, modified as BeforeRunHookContext, hookCtx.prompt);
      }

      // 构建 SDK 选项
      stage = "buildSdkOptions";
      const sdkOptions: ClaudeAgentOptions = {
        ...this.sdkOptions,
        ...callerOptions,
      };

      // 重置 checkpoints（每次 run 开始时清除上次的 checkpoint 记录）
      this._checkpointIds = [];

      // 执行查询
      stage = "executeQuery";
      const query = await this.executeQuery(messages, sdkOptions);
      stage = "query:iterate";
      const sdkMessages: SDKMessage[] = [];
      let structuredOutput: unknown = undefined;

      // 收集所有消息
      for await (const msg of query) {
        stage = `query:message:${msg.type}`;

        // ── File Checkpointing: 捕获 user message UUID 作为 checkpoint ──
        if (msg.type === "user" && (msg as any).uuid) {
          this._checkpointIds.push((msg as any).uuid);
        }

        // ── Structured Output: 从 result 消息中提取 structured_output ──
        if (msg.type === "result" && (msg as any).structured_output !== undefined) {
          structuredOutput = (msg as any).structured_output;
        }

        // 日志输出：onEvent 优先（多 Agent 并行友好），否则 console.log
        if (this.sdkOptions.onEvent) {
          this.dispatchLogEvent(msg);
        } else {
          this.prettyPrintSdkMessage(msg);
        }
        // 原始消息回调（用于外部日志记录）
        if (this.sdkOptions.onMessage) {
          this.sdkOptions.onMessage(msg);
        }
        sdkMessages.push(msg);
      }

      // 转换为框架格式
      const llmMessages = sdkMessages
        .filter((m): m is SDKAssistantMessage => m.type === "assistant")
        .map(sdkMessageToLLMMessage);

      const output = extractOutputFromMessages(sdkMessages);
      const tokenUsage = calculateTotalUsage(sdkMessages);
      const toolCalls = extractToolCallsFromMessages(sdkMessages);

      this.state.tokenUsage = addUsage(this.state.tokenUsage, tokenUsage);
      this.state.messages.push(...llmMessages);

      let agentResult: AgentRunResult = {
        success: true,
        output,
        messages: llmMessages,
        tokenUsage,
        toolCalls,
        structured: structuredOutput,
      };

      // --- 结构化输出验证（Zod schema，在 SDK structured_output 之上做 type-safe 验证）---
      if (this.config.outputSchema) {
        if (agentResult.structured === undefined) {
          try {
            agentResult = {
              ...agentResult,
              structured: extractJsonFromStructuredOutputToolCalls(sdkMessages),
            };
          } catch {
            try {
              agentResult = {
                ...agentResult,
                structured: extractJsonFromSdkMessages(sdkMessages),
              };
            } catch {
              // Fall back to validateStructuredOutput's output-string parsing.
            }
          }
        }
        agentResult = await this.validateStructuredOutput(
          agentResult,
          this.config.outputSchema,
        );
      }

      // --- afterRun hook ---
      if (this.config.afterRun) {
        agentResult = await this.config.afterRun(agentResult);
      }

      this.transitionTo("completed");
      this.emitAgentTrace(callerOptions, agentStartMs, agentResult);
      this.cleanupSkillIsolation();
      return agentResult;
    } catch (err) {
      console.error("[ClaudeAgent] executeRun:error", {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
      const error = err instanceof Error ? err : new Error(String(err));
      this.transitionToError(error);

      const errorResult: AgentRunResult = {
        success: false,
        output: error.message,
        messages: [],
        tokenUsage: ZERO_USAGE,
        toolCalls: [],
        structured: undefined,
      };

      this.emitAgentTrace(callerOptions, agentStartMs, errorResult);
      this.cleanupSkillIsolation();
      return errorResult;
    }
  }

  /**
   * 执行 SDK 查询
   */
  private async executeQuery(
    messages: LLMMessage[],
    options: ClaudeAgentOptions,
  ): Promise<QueryResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    // 提取最后一条用户消息作为 prompt
    const prompt = this.extractPrompt(messages);

    // ── allowedSkills 隔离：创建临时项目目录 ──
    let skillIsolationDir: string | undefined;
    let effectiveCwd = options.cwd;
    let effectiveSettingSources = options.settingSources;

    if (options.allowedSkills && options.allowedSkills.length > 0) {
      // 创建只包含白名单 skill 的临时项目目录
      skillIsolationDir = createSkillIsolationDir(
        options.allowedSkills,
        options.name ?? this.name,
      );
      effectiveCwd = skillIsolationDir;
      effectiveSettingSources = ["project"];
      this._skillIsolationDir = skillIsolationDir;
    }

    // 构建 skill deny 规则（allowedSkills 模式下不需要 deny 规则）
    const skillDenyRules = options.allowedSkills
      ? []
      : (options.deniedSkills ?? []).map((s) => `Skill(${s})`);
    const settingsOption =
      skillDenyRules.length > 0
        ? { permissions: { deny: skillDenyRules } }
        : undefined;

    // ── 构建并清理 SDK 环境变量（防止残留配置干扰）──
    const rawEnv = buildSdkEnv({
      baseEnv: options.env as Record<string, string | undefined> | undefined,
      authToken: (options.env?.ANTHROPIC_AUTH_TOKEN) as string | undefined,
      apiKey: (options.env?.ANTHROPIC_API_KEY) as string | undefined,
      baseUrl: (options.env?.ANTHROPIC_BASE_URL) as string | undefined,
      model: options.model,
    });

    // ── OpenTelemetry 环境变量注入 ──
    if (options.otel) {
      const o = options.otel;
      rawEnv.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
      rawEnv.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = "1";
      if (o.endpoint) rawEnv.OTEL_EXPORTER_OTLP_ENDPOINT = o.endpoint;
      if (o.serviceName) rawEnv.OTEL_SERVICE_NAME = o.serviceName;
      if (o.headers) rawEnv.OTEL_EXPORTER_OTLP_HEADERS = o.headers;
      if (o.protocol) rawEnv.OTEL_EXPORTER_OTLP_PROTOCOL = o.protocol;
      if (o.resourceAttributes) rawEnv.OTEL_RESOURCE_ATTRIBUTES = o.resourceAttributes;
      if (o.exportIntervalMs) {
        const ms = String(o.exportIntervalMs);
        rawEnv.OTEL_METRIC_EXPORT_INTERVAL = ms;
        rawEnv.OTEL_TRACES_EXPORT_INTERVAL = ms;
        rawEnv.OTEL_LOGS_EXPORT_INTERVAL = ms;
      }
      // signals: 默认全部开启，只导出用户指定的信号
      const signals = o.signals ?? ["traces", "metrics", "logs"];
      rawEnv.OTEL_TRACES_EXPORTER = signals.includes("traces") ? "otlp" : "none";
      rawEnv.OTEL_METRICS_EXPORTER = signals.includes("metrics") ? "otlp" : "none";
      rawEnv.OTEL_LOGS_EXPORTER = signals.includes("logs") ? "otlp" : "none";
    }

    const cleanEnv = sanitizeEnv(rawEnv);

    // 构建 SDK 选项（使用对象形式 query({ prompt, options })）
    // 合并动态 MCP 服务器（不 mutate sdkOptions，每次都生成快照）
    const mergedMcpServers =
      Object.keys(this._dynamicMcpServers).length > 0
        ? { ...(options.mcpServers ?? {}), ...this._dynamicMcpServers }
        : options.mcpServers;

    // ── Subagents: 当 agents 已定义时自动加入 Agent 工具 ──
    let effectiveAllowedTools = options.allowedTools;
    if (options.agents && Object.keys(options.agents).length > 0) {
      if (effectiveAllowedTools && effectiveAllowedTools.length > 0) {
        if (!effectiveAllowedTools.includes("Agent")) {
          effectiveAllowedTools = [...effectiveAllowedTools, "Agent"];
        }
      }
      // 如果 allowedTools 为空（允许所有工具），Agent 默认可用，无需额外处理
    }

    // ── File Checkpointing: 自动补充 replay-user-messages ──
    let effectiveExtraArgs = options.extraArgs;
    if (options.enableFileCheckpointing) {
      effectiveExtraArgs = {
        "replay-user-messages": null, // 确保 user messages 带 uuid
        ...effectiveExtraArgs,
      };
    }

    // ── outputFormat: 仅在调用方显式要求时才传给 SDK；outputSchema 继续由框架层验证 ──
    const effectiveOutputFormat = options.outputFormat;

    const sdkOptions: Record<string, unknown> = {
      cwd: effectiveCwd,
      env: cleanEnv,
      model: options.model,
      agent: options.agent,
      maxTurns: options.maxTurns,
      maxBudgetUsd: Number.isFinite(options.maxBudgetUsd) ? options.maxBudgetUsd : undefined,
      resume: options.resume,
      persistSession: options.persistSession,
      debug: options.debug,
      debugFile: options.debugFile,
      mcpServers: mergedMcpServers,
      agents: options.agents,
      hooks: options.hooks,
      plugins: options.plugins?.length ? options.plugins : undefined,
      outputFormat: effectiveOutputFormat,
      abortController: options.abortController,
      temperature: options.temperature,
      thinking: options.thinking ?? { type: "enabled", budgetTokens: 4000 },
      effort: options.effort ?? "max",
      betas: options.betas,
      timeoutMs: options.timeoutMs,
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      // File Checkpointing
      enableFileCheckpointing: options.enableFileCheckpointing ?? undefined,
      extraArgs: effectiveExtraArgs,
      // 权限控制
      permissionMode: options.permissionMode ?? "bypassPermissions",
      // 关键：bypassPermissions 模式下需要 allowDangerouslySkipPermissions
      ...(options.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      // 工具控制（默认禁止 WebFetch/WebSearch，使用 web-access skill 替代）
      allowedTools: effectiveAllowedTools?.length
        ? effectiveAllowedTools
        : undefined,
      disallowedTools: options.disallowedTools
        ? [...new Set([...options.disallowedTools, "WebFetch", "WebSearch"])]
        : undefined, // 暂时移除默认值
      // settings 配置（用于 skill deny 等）
      ...(settingsOption ? { settings: settingsOption } : {}),
      // settingSources - 控制是否从文件系统加载 skills
      // 明确传入时（包括空数组[]）都传递给 SDK，不传时由 SDK 取默认值
      ...(effectiveSettingSources !== undefined
        ? { settingSources: effectiveSettingSources }
        : {}),
      // canUseTool 回调（包含 skill deny 和 MCP disable 逻辑）
      canUseTool: this.buildCanUseTool(options),
      // systemPrompt 配置：injectNetworkRule 为 false 时不注入 CDP 规范
      systemPrompt: this.buildSystemPromptWithNetworkRule(
        options.systemPrompt,
        options.injectNetworkRule !== false,
      ),
    };

    // 调用 SDK 的 query 函数（使用对象形式）
    const queryResult = query({
      prompt,
      options: sdkOptions,
    });

    // 异步保存会话 ID（不阻塞消息流）
    queryResult
      .initializationResult()
      .then((initResult: any) => {
        const sessionId = initResult?.session_id ?? initResult?.sessionId;
        if (sessionId) {
          this.sessionId = sessionId;
        }
      })
      .catch(() => {
        // 忽略初始化错误
      });

    this.queryInstance = queryResult as unknown as QueryResult;
    this._lastQuery = queryResult as unknown as QueryResult;

    return queryResult as unknown as QueryResult;
  }

  /**
   * 构建系统提示词
   *
   * 当 `inject` 为 true（默认）时自动 append 网络检索规范（CDP 浏览器规范），
   * 所有通过 ClaudeAgent 执行的查询默认都会获得网络检索规范，上层代码无需手动添加。
   * 对于不需要联网的纯计算 Agent（Scorer、Decider、Formatter 等），
   * 传入 `inject = false` 可节省 token 并减少提示噪音。
   */
  private buildSystemPromptWithNetworkRule(
    userPrompt: string | Record<string, any> | undefined,
    inject = true,
  ): any {
    // 不注入网络规范时，直接透传（纯计算 Agent 节省 token）
    if (!inject) {
      if (!userPrompt) return { type: "preset", preset: "claude_code" };
      if (typeof userPrompt === "object") return userPrompt;
      return { type: "preset", preset: "claude_code", append: userPrompt };
    }

    // 获取当前时间，提示 Agent 注意时效性
    // Node/ICU 不一定支持 timeZoneName + dateStyle/timeStyle 的组合，这里用兼容写法
    const currentTime = `${new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "full",
      timeStyle: "medium",
    }).format(
      new Date(),
    )} ${Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local"}`;

    // 网络检索规范（内置，强制所有 Agent 遵循）
    const networkRule = `
## ⏰ 当前系统时间: ${currentTime}
> **注意**: 搜索时请务必检索最新信息，确保调研数据、行业趋势和文档版本的时效性与准确性。

## 🌐 联网搜索与浏览器操作规范 (Strict Protocol)

### 1. **最高优先级：web-access skill (CDP Browser)**
   - **连接检查**: 操作前必须检查 CDP 状态：curl -s "http://localhost:3456/info"
   - **启动服务**: 如果连接失败，必须调用 Skill(web-access) 启动浏览器环境。
   - **复用连接**: 如果已连接，直接复用现有连接，不要重复启动。
    - **标准搜索与访问流程**:
      1. **拆解关键词**: 根据调研目标拆解出精确的搜索关键词。
      2. **执行搜索**: 必须使用 google.com 或 bing.com 或 x.com在浏览器中直接搜索。
      3. **获取真实 URL**: 🚫 绝对禁止凭记忆、推测或常见的 URL 模式直接构造链接。必须从搜索引擎结果页（SERP）中获取真实存在的链接。
      4. **浏览器交互阅读**: 在浏览器中点击搜索结果链接进入目标页面。等待加载完成后，提取页面完整文本。
      5. **等待加载完成**: 打开网页后必须等待页面完全加载（包括动态内容），确认内容就绪后再进行阅读操作。
      6. **及时关闭 Tab**: 阅读并提取完网页内容后，立即关闭该 tab，避免同时打开过多 tab 导致浏览器卡顿或内存溢出。
   - **禁止行为 (Anti-Hallucination)**:
     - 🚫 禁止 URL 幻觉：严禁构造 "看起来像" 的 URL。
     - 🚫 禁止直接 curl 动态网站：对于现代网站（博客、文档、新闻站等），绝对不要使用 curl 或 r.jina.ai，它们经常返回 404 或拦截。**必须**使用 CDP 浏览器访问。

### 2. **次级方案：metaso-search skill**
   - 用于初步检索，返回 url/title/summary
   - 不直接作为最终信息源
   - 根据 metaso-search 返回的 url，仍必须使用 web-access CDP 浏览器去抓取网页完整内容

## ⚠️ 重要声明：重试与降级策略
- **必须多次尝试 web-access skill**，直到确认无法使用后才能降级。
- **多次尝试 CDP 连接失败后**（至少 3 次不同方式的检查/启动），才允许使用次级方案。
- 人可能会误操作点击"否"或拒绝连接请求，因此 **单次失败绝不降级**。
- 只有在 **连续 3 次或以上明确失败**（CDP 端口无响应 / Skill 启动报错 / 浏览器崩溃）后，才可降级到 metaso-search。`;

    // 用户未传入 systemPrompt — 使用预设 + 网络规范
    if (!userPrompt) {
      return { type: "preset", preset: "claude_code", append: networkRule };
    }

    if (typeof userPrompt === "object") {
      const existingAppend =
        typeof (userPrompt as { append?: unknown }).append === "string"
          ? ((userPrompt as { append?: string }).append ?? "")
          : "";
      return {
        ...userPrompt,
        append: existingAppend
          ? `${existingAppend}\n\n${networkRule}`
          : networkRule,
      };
    }

    // 用户传入字符串格式 — append 网络规范
    return {
      type: "preset",
      preset: "claude_code",
      append: `${userPrompt}\n\n${networkRule}`,
    };
  }
  private buildCanUseTool(options: ClaudeAgentOptions) {
    const deniedSkills = options.deniedSkills ?? [];
    const allowedSkills = options.allowedSkills;
    const disableMcp = options.disableMcp ?? false;

    // 如果没有任何过滤需求，返回 undefined（不注入拦截逻辑）
    if (
      !options.canUseTool &&
      deniedSkills.length === 0 &&
      !allowedSkills &&
      !disableMcp
    ) {
      return undefined;
    }

    return async (toolName: string, input: unknown) => {
      // 1. MCP 工具禁用检查
      if (disableMcp && toolName.toLowerCase().startsWith("mcp__")) {
        return false;
      }

      // 2. Skill 工具隔离检查（allowedSkills 优先于 deniedSkills）
      if (toolName === "Skill" || toolName.startsWith("Skill(")) {
        const requestedSkill = this.resolveRequestedSkill(toolName, input);
        if (requestedSkill) {
          // allowedSkills 白名单模式：只允许列表中的 skill
          if (allowedSkills) {
            if (!allowedSkills.includes(requestedSkill)) {
              return false;
            }
            // 在白名单中 → 放行（跳过 deniedSkills 检查）
          } else {
            // deniedSkills 黑名单模式
            if (deniedSkills.includes(requestedSkill)) {
              return false;
            }
            // 前缀匹配（支持 'lark-*' 格式）
            for (const pattern of deniedSkills) {
              if (pattern.endsWith("*")) {
                const prefix = pattern.slice(0, -1);
                if (requestedSkill.startsWith(prefix)) {
                  return false;
                }
              }
            }
          }
        }
      }

      // 3. 自定义 canUseTool 检查
      if (options.canUseTool) {
        return options.canUseTool(toolName, input);
      }

      return true;
    };
  }

  /**
   * 从 toolName 和 input 中解析请求的 skill 名称
   */
  private resolveRequestedSkill(
    toolName: string,
    input: unknown,
  ): string | null {
    // Skill(tool_name) 格式
    if (toolName.startsWith("Skill(") && toolName.endsWith(")")) {
      return toolName.slice(6, -1);
    }

    // 从 input 中提取
    if (input && typeof input === "object" && "skill" in input) {
      const skill = (input as Record<string, unknown>)["skill"];
      if (typeof skill === "string" && skill.trim()) {
        return skill.trim();
      }
    }

    return null;
  }

  /**
   * 从消息历史中构建 SDK prompt 字符串
   *
   * 单条消息（run() 调用）：直接返回消息文本。
   * 多条消息（prompt() 对话模式）：将历史格式化后拼接，以保留完整上下文，
   * 避免原版只取最后一条 user 消息导致前序内容（SharedMemory 摘要等）丢失。
   */
  private extractPrompt(messages: LLMMessage[]): string {
    // 快路径：只有一条消息（run() 的典型场景）
    if (messages.length === 1 && messages[0]?.role === "user") {
      return messages[0].content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    // 多条消息：格式化为对话历史，让 SDK 得到完整上下文
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = msg.content
          .filter(
            (b): b is TextBlock => b.type === "text",
          )
          .map((b) => b.text)
          .join("\n");
        if (text.trim()) parts.push(`[User]\n${text}`);
      } else if (msg.role === "assistant") {
        const text = msg.content
          .filter(
            (b): b is TextBlock => b.type === "text",
          )
          .map((b) => b.text)
          .join("\n");
        if (text.trim()) parts.push(`[Assistant]\n${text}`);
      }
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * 验证结构化输出
   */
  private async validateStructuredOutput(
    baseResult: AgentRunResult,
    schema: ZodSchema,
  ): Promise<AgentRunResult> {
    try {
      const parsed = baseResult.structured !== undefined
        ? baseResult.structured
        : extractJSON(baseResult.output);
      const validated = validateOutput(schema, parsed);

      this.transitionTo("completed");
      return {
        ...baseResult,
        structured: validated,
      };
    } catch (e) {
      // 验证失败，返回错误结果
      this.transitionTo("completed");
      return {
        ...baseResult,
        success: false,
        output: `Structured output validation failed: ${e instanceof Error ? e.message : String(e)}`,
        structured: undefined,
      };
    }
  }

  // ==========================================================================
  // Hook 辅助函数
  // ==========================================================================

  private buildBeforeRunHookContext(
    messages: LLMMessage[],
  ): BeforeRunHookContext {
    let prompt = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        prompt = messages[i]!.content.filter(
          (b): b is TextBlock => b.type === "text",
        )
          .map((b) => b.text)
          .join("");
        break;
      }
    }
    const { beforeRun, afterRun, ...agentInfo } = this.config;
    return { prompt, agent: agentInfo as AgentConfig };
  }

  private applyHookContext(
    messages: LLMMessage[],
    ctx: BeforeRunHookContext,
    originalPrompt: string,
  ): void {
    if (ctx.prompt === originalPrompt) return;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        const nonTextBlocks = messages[i]!.content.filter(
          (b) => b.type !== "text",
        );
        messages[i] = {
          role: "user",
          content: [{ type: "text", text: ctx.prompt }, ...nonTextBlocks],
        };
        break;
      }
    }
  }

  // ==========================================================================
  // 状态转换辅助函数
  // ==========================================================================

  private transitionTo(
    status: "idle" | "running" | "completed" | "error",
  ): void {
    this.state = { ...this.state, status };
  }

  private transitionToError(error: Error): void {
    this.state = { ...this.state, status: "error", error };
  }

  // ==========================================================================
  // Trace 事件发射
  // ==========================================================================

  private emitAgentTrace(
    options: Partial<ClaudeAgentOptions> | undefined,
    startMs: number,
    result: AgentRunResult,
  ): void {
    // 这里可以集成到框架的 trace 系统
    // 暂时不实现
  }

  // ==========================================================================
  // 工具上下文构建
  // ==========================================================================

  buildToolContext(abortSignal?: AbortSignal): ToolUseContext {
    return {
      agent: {
        name: this.name,
        role: this.config.systemPrompt?.slice(0, 60) ?? "assistant",
        model: this.config.model ?? '',
      },
      abortSignal,
    };
  }
}

// ============================================================================
// 导出辅助函数
// ============================================================================

/**
 * 创建预配置的 Claude Agent
 *
 * @param name - Agent 名称
 * @param options - SDK 配置选项
 * @returns 配置好的 ClaudeAgent 实例
 */
export function createClaudeAgent(
  name: string,
  options: Omit<ClaudeAgentOptions, "name"> = {},
): ClaudeAgent {
  const envModel = process.env.DEFAULT_MODEL;
  const config: AgentConfig = {
    name,
    model: options.model ?? envModel ?? "claude-sonnet-4-6",
    systemPrompt: options.systemPrompt,
    tools: options.allowedTools,
    maxTurns: options.maxTurns,
    outputSchema: options.outputSchema,
  };

  return new ClaudeAgent(config, options);
}
