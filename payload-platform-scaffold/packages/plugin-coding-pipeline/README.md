# @scaffold/plugin-coding-pipeline

把 `workflow/coding_pipline` (V3) 的自动编码流水线迁到 Payload CMS。

**Payload = control plane**：状态机 / 持久化 / UI / 调度 / prompt 注册表
**`workflow/core` = data plane**：ClaudeAgent / Tracer / git 工具

详见 [`PLAN.md`](./PLAN.md)。

## 用法（规划中）

```ts
// apps/platform/src/payload.config.ts
import { codingPipelinePlugin } from '@scaffold/plugin-coding-pipeline'

export default buildConfig({
  plugins: [
    codingPipelinePlugin({
      coreImportPath: '../../../workflow/core',
      seedDefaults: true,
    }),
  ],
})
```

## 当前状态

S1 骨架：collection / job / hook / runtime 文件就位，业务逻辑为 TODO。
