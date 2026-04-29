# Platform AI Task Field Integration

## Conclusion

Payload CMS supports this pattern. A business collection field can render a custom Admin field component, pass serializable AI task configuration through `admin.components.Field.clientProps`, read existing form values with Payload UI hooks, run an Agent Task through an endpoint, poll the Agent Task Run, and write the result back into the target field.

The validated example is the `articles.excerpt` textarea. It renders an `AI 生成摘要` button, maps `title` and `content` into task inputs, calls the stable task slug `generate-article-excerpt`, then writes the final output back into `excerpt`.

## Platform Boundary

These modules should move into the platform core capability layer rather than staying as optional business features:

- AI Models: provider/base URL/API key/model configuration and model test button.
- Prompts: reusable prompt templates and versionable prompt assets.
- Agent Skills: full skill folders, not only `SKILL.md`, because runtime tools and supporting files are part of the skill contract.
- Agent Tasks: reusable task definitions with variable mapping, output mode, model, skills, bash policy, and execution limits.
- Agent Task Runs: queue/run status, inputs, logs, final output, errors, and file workspace metadata.
- Agent execution job: `processAgentTaskRun`, model builder, skill staging, bash tool creation, output parsing, and writeback hooks.
- Admin AI field components: reusable buttons/wrappers that business modules can reference by import-map string path.

Business modules should consume these core capabilities, not own them.

## Business Module Contract

A business module should attach AI behavior with a small field-level config:

```ts
{
  name: 'excerpt',
  type: 'textarea',
  label: '摘要',
  admin: {
    components: {
      Field: {
        path: '@scaffold/plugin-agent/admin/AiTaskTextareaField#default',
        clientProps: {
          aiTask: {
            label: 'AI 生成摘要',
            agentTaskId: 'generate-article-excerpt',
            targetPath: 'excerpt',
            inputMappings: [
              { key: 'title', fieldPath: 'title' },
              { key: 'content', fieldPath: 'content' },
            ],
          },
        },
      },
    },
  },
}
```

Important details:

- Use stable task slugs for `agentTaskId`, not database IDs.
- Use `clientProps.aiTask` for custom Admin component configuration. In this setup, `field.custom` is not reliably available in the client field schema.
- Use string component paths to avoid TypeScript/package dependency cycles between business plugins and platform AI core.
- Keep task inputs explicit through `inputMappings`; this makes the button reusable for title, content, SEO fields, summaries, translations, tags, and other field-level generation.

## Runtime Flow

1. Admin renders the normal field wrapper, such as `TextareaField`.
2. The wrapper renders `AiTaskFieldButton` below the field.
3. The button reads current form state with `useAllFormFields`.
4. The button builds `inputs` from `inputMappings`.
5. It posts to `/api/agent-tasks/:slug/run`.
6. The endpoint resolves slug to the actual Agent Task ID, creates an Agent Task Run, and queues `processAgentTaskRun`.
7. The button polls `/api/agent-task-runs/:runId?depth=0`.
8. On success, the button dispatches a Payload form field update to `targetPath`.

## Current Local Execution

The current implementation uses host bash for local development. This is useful for testing real URL fetches and real file output, but it is not isolated.

Future production execution should use a remote sandbox runner endpoint. The endpoint should accept run metadata, prompt context, tool policy, and full skill folders, then return either final text output or file data/path metadata. The platform core should keep the same Agent Task Run contract so business modules do not change when the sandbox changes.

## Verified Evidence

- Article edit page renders `AI 生成摘要` next to the `摘要` textarea.
- Clicking the button queues and executes the `generate-article-excerpt` task.
- The generated summary is written back into the `excerpt` field.
- Screenshots:
  - `notes/assets/screenshots/07-article-ai-task-button.png`
  - `notes/assets/screenshots/08-article-ai-task-generated.png`

## Recommended Next Implementation Steps

1. Rename plugin-agent or move its collections/jobs/admin components into a platform-core AI package.
2. Keep package exports for admin import-map paths stable.
3. Add typed helpers for common field wrappers: textarea, text, rich text, select/tags, and array rows.
4. Add a generic `aiTask` field config schema that supports `replace`, `append`, and future structured JSON output mapping.
5. Add access control around who can trigger Agent Tasks from Admin.
6. Add task-run linking in the UI so a user can open logs from the field button after generation.
7. Add remote sandbox abstraction behind the current bash sandbox contract.
