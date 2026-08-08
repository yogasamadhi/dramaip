# 开发文档

本文档面向贡献者，说明项目架构、各包职责、数据流，以及「新增一个 AI 任务」「数据库迁移」「构建打包」的标准步骤。开始前请先读 [README](../../README.md) 了解产品定位与安装。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 43.2.0 + electron-vite 5 |
| 渲染层 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui |
| 状态 | Zustand |
| AI 编排 | LangGraph（`@langchain/langgraph`） |
| AI 模型 | OpenAI-compatible（任意符合该协议的 Provider） |
| 本地存储 | SQLite（better-sqlite3）+ Drizzle ORM |
| 包管理 | Bun workspace（1.3.14） |

## 仓库结构

```
packages/
  core/      类型 / Zod schema / 常量（纯类型，无副作用）
  db/        Drizzle schema + 版本化迁移 + 每实体一个 repository
  ai/        LangGraph 工作流 + prompt + provider + 解析/校验
  export/    Markdown / JSON / CSV 导出 + 完整项目包导入导出
apps/
  desktop/
    electron/  main 进程：ipc/、main.ts、db.ts、preload.ts
    renderer/  React 应用：pages/、components/、stores/、lib/ipc.ts
scripts/
  smoke-db.ts  DB 冒烟测试（迁移 + 各 repo CRUD + 项目包往返）
tests/
  *.test.ts   轻量单元测试（IPC 契约 / AI 任务注册 / JSON parser）
```

## 五层架构与数据流

一次「AI 生成章节」请求穿越五层：

```
渲染层 (pages/sections)
  └─ ipc.ai.run({ taskType: 'generate_chapter', ... })   ← lib/ipc.ts（类型化契约）
主进程 (electron/ipc/ai.ipc.ts)
  └─ resolveProviderForTask(repos, taskType)              ← 按任务组选模型 / 回退默认
  └─ runNovelWorkflow({ repos, provider }, input)          ← packages/ai
AI 层 (packages/ai/graphs/novel-workflow.graph.ts)
  ├─ build_prompt（loader 取 prompt 模板 + context-builder 拼上下文）
  ├─ call_model（provider.chat）
  ├─ parse_output（extractJson / 取原文）
  ├─ validate_output（Zod 校验）
  └─ save_result / save_ai_run（记账 + 部分任务自动落库）
DB 层 (packages/db/repositories/*) → SQLite
```

**关键约定：**
- 渲染层永远不直接碰 DB，全部经 `lib/ipc.ts` 的类型化方法。
- IPC 参数校验契约集中在 `packages/core/src/ipc-contract.ts`；Electron 主进程只负责安装校验层，新增高风险 channel 时必须补 exact schema。
- `preload.ts`（contextBridge）与 `renderer/src/lib/ipc.ts`（StudioApi 接口）仍需保持方法形状一致。
- 失败优先返回结构化 `{ ok, error }`，渲染层 catch 后 `toast.error`。

## 新增一个 AI 任务（最常见扩展）

以「生成 X」为例，标准步骤：

1. **core 类型**：`packages/core/src/types/index.ts` 在 `NovelTaskType` 联合追加 `'generate_x'`。
2. **core schema**：`packages/core/src/schemas/index.ts` 加 `XResultSchema`（Zod），并登记进 `ALL_RESULT_SCHEMAS`。
3. **core 常量**：`constants/index.ts` 的 `TASK_TYPE_LABELS` 加中文标签；按需把 taskType 归入 `TASK_GROUPS`（用于按任务选模型）。
4. **prompt**：`packages/ai/src/prompts/zh-CN/<域>/generate-x.md`，顶部 YAML 头含 `taskType`/`output: json|text`/`version`。
5. **任务定义注册**：`packages/ai/src/prompts/loader.ts` `?raw` import + 写入 `TASK_DEFINITIONS`，同时声明 `output`、结构化任务的 `schema`、章节正文任务的 `writesChapterContent`。
6. **context**：若需新上下文维度，在 `context-builder.ts` 加 builder 并在 `build-prompt.node.ts` 的 switch 接入。
7. **落库**：若产物要自动入库，在 `save-result.node.ts` 加分支；若是 generate 类（预览后落库），在 `persistence.ts` 的 `applyGeneratedArtifact` 加分支。
8. **UI**：渲染层加触发按钮 → `ipc.ai.run({ taskType: 'generate_x' })` → 预览弹窗 → `ipc.ai.applyResult(...)`。
9. **测试**：`tests/ai-task-registry.test.ts` 会校验所有 `NovelTaskType` 都在 `TASK_DEFINITIONS` 注册，JSON 任务必须声明 schema。

## 数据库迁移机制

- 迁移框架：`packages/db/src/migrator.ts`。
- `schema_migrations(version, applied_at)` 表记录已应用版本，保证「每版本有明确 migration」。
- 每个 migration 在独立事务中执行，业务 DDL 与版本记录一起提交；失败时回滚，避免留下不可重试的半完成版本。
- **新增迁移**：在 `MIGRATIONS` 数组追加一个 `{ version, name, up(raw) }`。新表使用 `CREATE TABLE IF NOT EXISTS`，新增列使用 `addColumnIfMissing` 或 `migrations.ts` 的列级 helper，保持幂等。
- `createDb(dbPath)` 启动时自动 `runMigrations`：首次建全部表为 v1；旧库经 IF NOT EXISTS 安全补齐，**数据零丢失**。
- **新增列**（对已有表）：优先在 `migrations.ts` 的 `ADD_COLUMN_SPECS` 加 `{ table, column, sql }`，`ensureColumns` 会用 `PRAGMA table_info` 探测后 `ALTER TABLE ADD COLUMN`。
- 验证：`bun run test:db` 会运行迁移回放测试和 `scripts/smoke-db.ts`，并在结束后恢复 Electron ABI。

## 模型配置（v1.0）

- 支持多模型 + 默认模型 + **按任务组指定模型**。
- `resolveProviderForTask(repos, taskType)` 优先查 `task_model_bindings`（按 `TASK_GROUPS` 归组），命中则用绑定模型，否则回退默认。
- 连接测试：`model:testConnection` 发最小 chat 请求。
- Token/耗时统计：`ai_runs` 表记录每次调用的 token/latency/status，`summarizeAiRuns` 按模型聚合（设置 → Token 与耗时统计）。

## 本地备份（v1.0）

- **自动备份**：应用启动时把 `studio.db` 复制到 `userData/backups/studio-<时间戳>.db`，保留最近 7 份。
- **项目包**：`.sdnspkg`（JSON）含项目全部关联数据；导入时用事务整体写入、id 重映射、保留外键。

## 构建与打包

```bash
bun install                 # 安装依赖（.npmrc 已配置 Electron 镜像）
bun run typecheck           # 全量类型检查（5 个包）
bun run test:unit           # Node 内置 test runner + tsx 的轻量单元测试
bun run test:db             # 切 Node ABI → 迁移/DB smoke → 切回 Electron ABI
bun run test:e2e            # Electron E2E smoke：创建项目/章节/模型配置/项目包往返
bun run test                # typecheck + unit + DB smoke
bun run format:check        # 轻量格式检查（尾随空白/文件末尾换行）
bun run dev                 # 启动开发模式
bun run --filter @sdns/desktop build   # 构建产物
bun run package             # electron-builder 打包（mac dmg / win nsis / linux AppImage+deb）
bun run package:smoke       # 本平台安装包 + 打包后启动/DB 初始化 smoke
```

- `bun run test:e2e` 会先构建桌面端并把 `better-sqlite3` 重编到 Electron ABI；Linux 无显示环境可用 `xvfb-run -a bun run test:e2e`。
- 原生模块 `.node` 二进制在 `electron-builder.yml` 的 `asarUnpack` 中解包。
- 打包 smoke 详见 [RELEASE.md](../release/RELEASE.md)。
- `bun run test:db` 封装了 `bun run rebuild:node` 与 `bun run rebuild:electron`，通常不需要手动进入 `node_modules` 重编。

## 安全与运行时边界

- 主窗口启用 `contextIsolation`、`sandbox`、`webSecurity`，并对外链跳转做协议白名单；生产态默认只允许 HTTPS，开发态额外允许 localhost HTTP 用系统浏览器打开。
- 主进程在注册 IPC 时安装统一参数校验层。所有 `ipcMain.handle` 调用会先检查参数数量和基础形状，再进入业务 handler。
- 模型与视频 Provider 的 `apiKey` 由 Electron 主进程写入用户数据目录下的本地加密凭据文件。目录权限为 `0700`，密钥与凭据文件权限为 `0600`，不会访问 macOS Keychain、Windows Credential Manager 或 Linux Secret Service。SQLite 的 `api_key` 列只保存 `local:v1:<reference>`；Provider 使用前只从主进程内存缓存取值，renderer 始终只获得 `masked:v1:*` 掩码。
- 启动时会扫描模型和视频 Provider Key 的存储状态，将 `plain:v1:` 和裸明文记录迁移到本地凭据文件。旧 `keychain:v1:` 和 `enc:v1:` 值不会触发系统凭据访问，用户需在设置页重新输入对应 API Key。本地凭据文件不可用时拒绝保存新 Key，绝不降级为 SQLite 明文。
- AI / 视频 HTTP provider 统一走带超时和重试的请求 helper，默认只重试网络错误和 408/429/5xx 等可恢复状态。

## 包构建约定

当前 workspace 包仍通过 tsconfig path / electron-vite alias 指向 `src`，这是为了支持 prompt 的 `?raw` 导入和 Electron 开发态热更新。若未来要发布独立 npm 包，应先增加 bundler 构建（复制 prompt 资源并处理 `?raw`），再把 `exports` 切到 `dist`。
