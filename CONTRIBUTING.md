# 贡献指南

感谢参与本项目！这是一款**本地优先**的桌面端 AI 短剧小说写作工具。请遵循以下约定，保持代码库整洁、可开源。

## 开发环境准备

```bash
git clone <repo>
cd dramaIp
pnpm install
```

要求：Node 20+、pnpm 9+。跨平台（macOS / Windows / Linux）。

## 常用命令

```bash
pnpm dev                # 启动 Electron + Vite 热更新开发模式
pnpm typecheck          # 全量类型检查（提交前必跑）
pnpm --filter @sdns/core typecheck   # 单包类型检查
pnpm lint               # 代码检查（如配置）
```

### 跑 DB 冒烟测试

`scripts/smoke-db.ts` 验证迁移幂等、各 repository CRUD、项目包导入导出往返。better-sqlite3 默认按 **Electron** ABI 编译；在系统 Node 下运行需先重编译：

```bash
# 为当前 Node ABI 重编译（仅本地测试用，提交前请勿改动 node_modules 产物）
cd node_modules/.pnpm/better-sqlite3@<版本>/node_modules/better-sqlite3
pnpm dlx node-gyp rebuild
cd - && npx tsx scripts/smoke-db.ts
# 测完若要恢复为 Electron ABI：pnpm rebuild better-sqlite3
```

## 代码约定

### TypeScript 与分层

- **严格类型**：禁用 `any`；IPC 入参/出参用 Zod 或显式接口。
- **五层不越界**：渲染层只经 `lib/ipc.ts` 调主进程；主进程只经 repository 调 DB；DB 层不含业务逻辑。
- **IPC 契约单一来源**：`preload.ts`（contextBridge）与 `renderer/src/lib/ipc.ts`（`StudioApi` 接口）必须同步修改。
- 失败优先返回结构化 `{ ok: false, error }`，渲染层 catch 后 `toast.error`；不要让异常冒泡导致渲染层白屏。

### Prompt 工程

- 所有 prompt 放 `packages/ai/src/prompts/zh-CN/<域>/`，Markdown 顶部 YAML 头含 `taskType` / `output: json|text` / `version`。
- 不要在代码里硬编码 prompt 字符串。详见 [PROMPT_GUIDE](./PROMPT_GUIDE.md)。

### Zod 校验

- 每个产出 JSON 的任务都要有 Zod schema（`packages/core/src/schemas/`），登记进 `ALL_RESULT_SCHEMAS`。
- 校验失败会触发一次自动重试（build-prompt 追加修复指令）。

### 命名与风格

- Repository 文件：`<entity>.repo.ts`，导出 `listX/getX/createX/updateX/deleteX`。
- 常量：`UPPER_SNAKE_CASE`；中文标签用 `*_LABELS` 记录。
- 注释用中文（与现有代码一致），保持与周围代码风格一致。

## 提交规范

使用约定式提交（Conventional Commits）：

```
feat(<scope>): 新增 <功能>
fix(<scope>): 修复 <问题>
docs: 文档变更
refactor(<scope>): 重构（无行为变化）
chore: 构建/依赖/工具链
```

- 一个提交做一件事，描述清晰。
- 提交前确保 `pnpm typecheck` 全绿。
- 涉及数据库结构变化必须加迁移（见 [DEVELOPMENT](./DEVELOPMENT.md#数据库迁移机制v10)）并扩展 `smoke-db.ts`。

## 本地优先原则

- 所有数据默认存本地 SQLite，不依赖云服务。
- 模型 API Key 仅本地保存，不上传。
- 新增功能优先考虑「离线可用」「数据不丢失」「失败有提示」。

## 目录速查

| 想做的事 | 看这里 |
|---|---|
| 加一个 AI 任务 | [DEVELOPMENT - 新增一个 AI 任务](./DEVELOPMENT.md#新增一个-ai-任务最常见扩展) |
| 改数据库 | [DEVELOPMENT - 数据库迁移机制](./DEVELOPMENT.md#数据库迁移机制v10) |
| 写 prompt | [PROMPT_GUIDE](./PROMPT_GUIDE.md) |
| AI 视频链路 | [AI_VIDEO_GUIDE](./AI_VIDEO_GUIDE.md) |
| 打包发布 | [DEVELOPMENT - 构建与打包](./DEVELOPMENT.md#构建与打包) |
