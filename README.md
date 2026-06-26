# 短剧 IP 小说写作工作台 (short-drama-novel-studio)

本地优先的桌面端 AI 写作工具，专门用于创作「适合改编为短剧的中文小说」。

基于 [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) 构建。

## 技术栈

- **桌面端**：Electron 38 + electron-vite
- **前端**：React 19 + Vite + TypeScript
- **UI**：Tailwind CSS + shadcn/ui（浅色主题）
- **状态**：Zustand
- **数据库**：SQLite (better-sqlite3) + Drizzle ORM
- **校验**：Zod
- **编辑器**：TipTap（正文以 Markdown 存储）
- **AI 工作流**：LangGraph.js + OpenAI-compatible API

## 目录结构

```
apps/desktop        Electron 桌面端（main / preload / renderer）
packages/
  core              类型、Zod schema、常量
  db                Drizzle schema、client、repositories
  ai                LLM provider、context builder、LangGraph 节点与工作流、prompts
  export            Markdown / JSON 导出
```

## 快速开始

```bash
pnpm install          # 安装依赖
pnpm rebuild          # 按 Electron ABI 重编 better-sqlite3（首次/切换 Node↔Electron 后必做）
pnpm dev              # 启动开发模式（Electron + Vite）
```

> **重要**：如果 `pnpm dev` 启动时报 `Cannot read properties of undefined (reading 'whenReady')`，
> 说明当前 shell 设了 `ELECTRON_RUN_AS_NODE=1`（常见于从其它基于 Electron 的工具里启动）。
> 解决：`env -u ELECTRON_RUN_AS_NODE pnpm dev`，或在新终端里运行。

数据库表在应用首次启动时由 `ensureSchema()` 幂等自动创建（原始 `CREATE TABLE`），
无需手动跑迁移；如需根据 Drizzle schema 重新生成 SQL，可用 `pnpm db:generate` / `pnpm db:push`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Electron + Vite 开发服务 |
| `pnpm build` | 构建产物（main / preload / renderer） |
| `pnpm package` | 用 electron-builder 打包 |
| `pnpm db:generate` | 根据 schema 生成 SQL 迁移（可选） |
| `pnpm rebuild` | 按 Electron ABI 重编原生模块 better-sqlite3 |
| `pnpm typecheck` | 全仓类型检查（core / db / ai / export / desktop） |

## 数据层冒烟测试

`scripts/smoke-db.ts` 覆盖全部实体的 CRUD、级联删除与持久化（注入式，无需 API key）。
better-sqlite3 是原生模块，需先按 Node ABI 编译再跑：

```bash
# 1) 切到 Node ABI（冒烟用）
(cd node_modules/.pnpm/$(ls node_modules/.pnpm | grep -m1 '^better-sqlite3@')/node_modules/better-sqlite3 && pnpm dlx node-gyp rebuild)
pnpm dlx tsx scripts/smoke-db.ts
# 2) 跑完切回 Electron ABI，否则 pnpm dev 会崩
pnpm rebuild
```

## 数据存储

所有数据保存在本地 SQLite，数据库文件位于系统 `userData` 目录下 `studio.db`。
API Key 仅本地保存于 `model_configs` 表。

**数据安全（v1.0）：**
- **版本化迁移**：`schema_migrations` 表记录迁移版本，应用升级时自动补齐、数据零丢失。
- **自动备份**：每次启动自动复制一份 `studio.db` 到 `userData/backups/`，保留最近 7 份。
- **项目包导入导出**：工作台「导出 → 完整项目包（.sdnspkg）」导出项目全部关联数据；首页「导入项目包」可还原为新项目（id 重映射、外键保留）。

## 文档

- [开发文档](./DEVELOPMENT.md) —— 架构、数据流、新增 AI 任务、数据库迁移、构建打包
- [贡献指南](./CONTRIBUTING.md) —— 开发约定、提交规范、本地优先原则
- [Prompt 工程指南](./PROMPT_GUIDE.md) —— prompt 体系、JSON 输出规范、模板系统、多 Agent 编剧室
- [AI 视频生成链路指南](./AI_VIDEO_GUIDE.md) —— 剧本→分镜→镜头→视频平台、各平台 Prompt 要点与风险
- [ROADMAP](./ROADMAP.md) —— 版本规划与进度

## AI 调用路径

```
React UI ──IPC──▶ Electron Main ──▶ AI Service ──▶ LangGraph.js ──▶ LLM Provider ──▶ SQLite(ai_runs)
```

React 组件不直接调用模型或数据库；一切经 IPC 进入主进程的 LangGraph 工作流。
