# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Project Overview

This is a Payload CMS learning project containing a GEO (Generative Engine Optimization) content engineering platform migrated from a Laravel/PHP system (GEOFlow-main) to Payload CMS 3 + Next.js 16 + TypeScript. The core application lives in `payload-platform-scaffold/`.

## Common Commands

All commands run from `payload-platform-scaffold/` unless noted.

```bash
pnpm install                          # Install all workspace dependencies
pnpm dev                              # Start Next.js dev server on port 3000
pnpm build                            # Production build (--max-old-space-size=8000)
pnpm generate:types                   # Generate TypeScript types from Payload schema
pnpm generate:importmap               # Regenerate Admin component import map (required after adding/changing admin components)
cd apps/platform && pnpm test:flow    # Run full flow integration test via tsx
cd apps/platform && pnpm test:vector  # Run vector store test
cd apps/platform && pnpm worker       # Start standalone Jobs worker process
cd apps/platform && pnpm migrate:geoflow  # Run GEOFlow data migration script
```

After adding/modifying admin custom components, always run `pnpm generate:importmap` then `pnpm generate:types`.

## Architecture

### Monorepo Structure

```
payload-platform-scaffold/          # pnpm workspace monorepo (no Turborepo/Nx)
├── apps/platform/                  # Sole runtime app: Next.js + Payload CMS
├── packages/shared/                # Cross-plugin shared utilities
├── packages/plugin-*              # 9 business plugins + 1 template
└── docs/                           # Architecture & plugin development docs
```

Workspace is defined in `pnpm-workspace.yaml` with `apps/*` and `packages/*`. All internal packages use `@scaffold/` namespace with `workspace:*` references. Build uses Next.js Turbopack with root pinned to monorepo root (`next.config.ts` turbopack.root).

### apps/platform — Assembly Layer Only

`apps/platform` does NOT contain business logic. It only:
- Registers plugins in `payload.config.ts` (strict load order matters)
- Provides Next.js route handlers under `src/app/(payload)/`
- Defines the root `Users` auth collection
- Configures database adapter (SQLite dev / PostgreSQL prod, switched via `DB_DRIVER` env)
- Configures MCP exposure via `@payloadcms/plugin-mcp`
- Seeds default AI models on first startup (`src/seed.ts`)

Database switching logic in `payload.config.ts` uses `createRequire` to dynamically load `@payloadcms/db-postgres` only when `DB_DRIVER=postgres`, avoiding Turbopack static resolution errors.

### Plugin Architecture

Every plugin follows the same pattern: a factory function `(options) => Plugin => Config` with `{ enabled: false }` support. Plugin load order in `payload.config.ts` is:

```
materials → knowledge-base → ai-engine → content → tasks → agent → moderation → url-import → site-settings → mcpPlugin
```

This order matters because later plugins reference collections defined by earlier ones via `relationship` fields.

Each plugin can contribute: Collections, Globals, Jobs, Hooks, Access rules, Admin components (via `exports` in `package.json`), Custom endpoints.

**Plugin packages and their domains:**

| Package | Collections/Globals | Purpose |
|---------|-------------------|---------|
| `shared` | none | AI client (OpenAI-compat, 6 providers + local), vector store (SQLite/pgvector), sensitive word matching, HTML→Lexical conversion, template rendering |
| `plugin-materials` | `authors`, `title-libraries`, `titles`, `keyword-libraries`, `keywords`, `image-libraries`, `images`, `tags` | 8 material libraries with countSync hook |
| `plugin-knowledge-base` | `knowledge-bases`, `knowledge-chunks`, `kb-uploads`, `kb-index-runs` | RAG: file/URL upload → chunking → embedding → vector search. 2 Jobs + 3 endpoints |
| `plugin-ai-engine` | `ai-models`, `prompts` | AI model management (6 provider types), prompt template library, test connection endpoint |
| `plugin-content` | `categories`, `articles`, `article-reviews` | Article CRUD + categories + review workflow. Articles have SEO fields, AI generation flag, sensitive word scan hook |
| `plugin-tasks` | `tasks`, `task-runs`, `task-schedules`, `worker-heartbeats` | Task orchestration: select material libs + model + prompt → control publishing pace. processTaskRun Job |
| `plugin-agent` | `agent-tasks`, `agent-task-runs`, `agent-skills` | AI Agent executor: prompt + skills + model → autonomous tool-calling (bash). processAgentTaskRun Job (~18KB core logic). Exports `aiTaskButtonField` for embedding AI buttons in other collections |
| `plugin-moderation` | `sensitive-words`, `activity-logs`, `system-logs` | Content moderation: sensitive word dictionary + audit logs |
| `plugin-url-import` | `url-import-jobs`, `url-import-job-logs` | URL batch fetch/import. importUrlBatch Job |
| `plugin-site-settings` | `site-settings` (Global) | Site info, theme, SEO defaults, security, upload config |
| `plugin-example` | `examples` | Template/scaffold for creating new plugins |

### packages/shared — Cross-Plugin SDK

Import paths:
- `@scaffold/shared` → env helpers, template rendering, type exports
- `@scaffold/shared/ai` → `createAiClient`, `generateText`, `embed` (OpenAI-compatible, supports local transformers.js)
- `@scaffold/shared/vector` → `createVectorStore`, `getVectorStore` (SQLite cosine / pgvector backends)
- `@scaffold/shared/moderation` → `matchSensitiveWords`
- `@scaffold/shared/lexical` → `htmlToLexical`, `plainTextToLexical`
- `@scaffold/shared/template` → `renderTemplate` ({{key}} placeholder rendering)

AI client supports providers: `local` (transformers.js, embed only), `openai`, `anthropic`, `zhipu`, `bytedance`, `openai-compatible` (DeepSeek/通义/ollama etc.).

### MCP Integration

MCP endpoint: `http://localhost:3000/api/mcp`. Only explicitly configured collections are exposed. Current exposure:

- `articles`: find + create + update (no delete)
- `tasks`: find + create + update (no delete)
- `prompts`: find + create + update (no delete)
- `knowledge-bases`: read-only
- `titles`, `keywords`: find + create + update (no delete)
- `categories`: read-only

### Database & Vector Store

- **Dev**: SQLite (`@payloadcms/db-sqlite`), data file `apps/platform/data.db`. Vector store uses cosine similarity on JSON-embedded vectors in `knowledge-chunks.embedding`.
- **Prod**: PostgreSQL with pgvector (`@payloadcms/db-postgres`). Vectors stored in dedicated `knowledge_vectors` table with IVFFlat index.
- Switched via `DB_DRIVER` env var. Vector backend auto-inferred from DB driver unless `VECTOR_STORE` is explicitly set.

### Agent System

Agent tasks (`agent-tasks`) define a prompt + optional skills + AI model. When executed via `/api/agent-tasks/:id/run`, the `processAgentTaskRun` Job runs an AI agent loop with tool-calling capability (bash via `just-bash`). Skills are uploaded as zip files containing a `SKILL.md` and scripts, stored under `.geoflow-data/agent-skills/`. Agent runs create isolated workspaces under `.geoflow-data/agent-runs/<id>/`.

The `aiTaskButtonField` export from `plugin-agent` allows any collection field to have an AI generation button (e.g., article excerpt generation).

### Environment Variables

Key env vars in `apps/platform/.env.example`:
- `PAYLOAD_SECRET` (required)
- `DB_DRIVER=sqlite|postgres`, `DATABASE_URL`
- `VECTOR_STORE=sqlite|pgvector` (auto-inferred if unset)
- `EMBED_PROVIDER=local`, `EMBED_MODEL=Xenova/all-MiniLM-L6-v2`
- `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (optional, for LLM seeding)
- `JOBS_AUTORUN=false` to disable built-in cron worker (use standalone worker in prod)

### GEOFlow-main (Reference Only)

`GEOFlow-main/` is the original Laravel 12 / PHP 8.2 system that was migrated to the Payload scaffold. It is NOT built or run in this repo. All its business logic has been systematically migrated into the 8 `plugin-*` packages.

### Other Directories

- `payload-docs/` — Offline copy of Payload CMS official docs (~178 MDX files), for reference only
- `notes/` — Learning notes (8 markdown files) about Payload CMS architecture and AI integration patterns
