# 短剧 IP 小说写作工作台 (short-drama-novel-studio)

本地优先的桌面端 AI 写作工具，专门用于创作「适合改编为短剧的中文小说」。

基于 [PROJECT_BRIEF.md](../docs/product/PROJECT_BRIEF.md) 构建。

## 核心能力

- 主流程向导：在项目工作台按「设定 -> 人物 -> 大纲 -> 章节 -> 质量闸门 -> 改编 -> 剧本 -> 分镜 -> 视频」检查进度和下一步。
- 小说创作：项目设定、人物卡、大纲、章节编辑、AI 续写/改写/润色，并支持修稿任务预览采用。
- 长篇一致性：章节记忆、人物状态、事件时间线、伏笔、视觉档案、一致性检查。
- AI 可信控制：Agent 指挥台可把自然语言命令转成执行计划；生成前可查看上下文分段、token 估算，并固定或排除章节、人物、样本和视觉档案。
- 短剧改编：小说转分集大纲、剧本生成、拆场景、分镜、镜头 Prompt、视频任务。
- 创意诊断：新鲜度评分、反套路三档方案、爽点/钩子曲线、修稿任务单、质量闸门、观众模拟、视频风险前置。
- 本地样本库与灵感台：上传 `.md` / `.txt` / `.docx` 样本文档，拆章并抽取抽象结构卡片；灵感台汇总样本卡、类型模板、反套路方案和移动灵感导入。
- 交付导出：支持完整项目包、小说投稿包、短剧提案包、分集交付包、分镜交付 Markdown / JSON / CSV。

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

数据库连接由 `packages/db/src/client.ts` 的 `createDb()` 创建；应用启动时会自动执行
`packages/db/src/migrator.ts` 中的版本化迁移，并记录到 `schema_migrations`。无需手动跑
数据库迁移；`pnpm db:generate` / `pnpm db:push` 仅用于维护 Drizzle schema 相关产物，不是运行时升级入口。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Electron + Vite 开发服务 |
| `pnpm build` | 构建产物（main / preload / renderer） |
| `pnpm package` | 用 electron-builder 打包 |
| `pnpm package:smoke` | 构建本平台安装包并启动打包后应用验证 DB 初始化 |
| `pnpm db:generate` | 根据 schema 生成 SQL 迁移（可选） |
| `pnpm rebuild` | 按 Electron ABI 重编原生模块 better-sqlite3 |
| `pnpm typecheck` | 全仓类型检查（core / db / ai / export / desktop） |
| `pnpm test:unit` | 轻量单元测试（IPC 契约 / AI 任务注册 / 导出包 / JSON parser） |
| `pnpm test:db` | 运行迁移回放与 DB 冒烟测试，并在结束后恢复 Electron ABI |
| `pnpm test:e2e` | 构建桌面端并运行 Electron E2E smoke（项目/章节/模型配置、P0 主流程、Agent 指挥台、拆书卡片、修稿采用、投稿包导出、项目包往返） |
| `pnpm test` | 类型检查 + 单元测试 + DB 冒烟测试 |

## 数据层冒烟测试

`pnpm test:db` 会先把 better-sqlite3 编译到当前 Node ABI，运行迁移回放与
`scripts/smoke-db.ts`，最后再把 better-sqlite3 编译回 Electron ABI。
`scripts/smoke-db.ts` 覆盖全部实体的 CRUD、级联删除、持久化和项目包往返（注入式，无需 API key）。

```bash
pnpm test:db
```

## 数据存储

所有数据保存在本地 SQLite，数据库文件位于系统 `userData` 目录下 `studio.db`。
模型与视频 Provider 的 API Key 不进入 SQLite 明文，SQLite 只保存系统 Keychain 引用。

**数据安全（v1.0）：**
- **版本化迁移**：`schema_migrations` 表记录迁移版本，应用升级时自动补齐、数据零丢失。
- **事务化升级**：每个数据库 migration 与版本记录在同一事务中提交，失败会回滚，避免半升级状态。
- **自动备份**：每次启动自动复制一份 `studio.db` 到 `userData/backups/`，保留最近 7 份。
- **项目包导入导出**：工作台「导出 → 完整项目包（.sdnspkg）」导出项目全部关联数据；首页「导入项目包」可还原为新项目（id 重映射、外键保留）。
- **项目包 v6**：包含创意诊断报告、反套路方案、修稿任务、内容版本、质量闸门、观众模拟、曲线报告、工作流记录、项目 Skills、项目 Agent 方案、灵感台收藏、本地样本库、视频前置资产和可选资产清单。
- **密钥保护**：模型与视频 Provider 的 API Key 仅在主进程解密使用，返回界面时显示为掩码。

## 云端账号（可选）

云端账号默认关闭，不影响离线项目或用户自带 API Key。开发时可显式启用：

```bash
DESKTOP_CLOUD_LOGIN_ENABLED=true \
DESKTOP_CLOUD_WEB_ORIGIN=http://127.0.0.1:3009 \
DESKTOP_CLOUD_BFF_ORIGIN=http://127.0.0.1:8000 \
pnpm dev
```

登录使用系统浏览器、一次性 code + PKCE 和 `127.0.0.1` 临时回调；refresh token 保存在系统
Keychain，access token 仅存在 Electron main process 内存。生产环境两个 Cloud Origin 必须使用
HTTPS。

登录后可在「模型设置」选择 `DramaIP Cloud` 模型。它不要求、也不会保存平台 API Key：仅当前 AI
任务的受限上下文（最多 8 条消息、24,000 字符）从 Electron main process 经 Kong 与 Desktop BFF 到
AI Gateway。每个调用带独立幂等键；平台完成 quota/cost 结算后，云端账号页会刷新余额。断网、超时或
Provider 失败只会失败本次云端任务，本地项目、离线编辑和用户自带 API Key 模型继续可用。详见
[LM3-26 登录边界](../docs/loop/LM3-26-Desktop-BFF-PKCE.md) 与
[LM3-27 Cloud AI 边界](../docs/loop/LM3-27-Desktop-Cloud-AI.md)。

## 文档

- [文档目录](./docs/README.md) —— 按产品、开发、发布、流程分类的文档入口
- [开发文档](./docs/engineering/DEVELOPMENT.md) —— 架构、数据流、新增 AI 任务、数据库迁移、构建打包
- [贡献指南](./docs/engineering/CONTRIBUTING.md) —— 开发约定、提交规范、本地优先原则
- [用户手册](./docs/product/USER_GUIDE.md) —— 安装启动、模型配置、创作流程、备份恢复、项目包、视频生成
- [故障排查](./docs/product/TROUBLESHOOTING.md) —— AI 失败、视频平台、数据库备份、项目包、日志诊断
- [通用文档目录](../docs/README.md) —— 跨桌面端和平台端的产品路线与流程记录
- [移动灵感导入](../docs/product/MOBILE_INSPIRATION_IMPORT.md) —— 移动端轻量记录边界与桌面灵感台 JSON/Markdown 导入格式
- [生态同步与知识库边界](../docs/product/ECOSYSTEM_SYNC_MARKET_KNOWLEDGE.md) —— 云同步、资源市场和语义知识库的后续路线与隐私边界
- [Prompt 工程指南](./docs/engineering/PROMPT_GUIDE.md) —— prompt 体系、JSON 输出规范、模板系统、多 Agent 编剧室
- [AI 视频生成链路指南](./docs/engineering/AI_VIDEO_GUIDE.md) —— 剧本→分镜→镜头→视频平台、各平台 Prompt 要点与风险
- [发布打包](./docs/release/RELEASE.md) —— 打包 smoke、签名公证、自动更新源和回滚策略
- [RC 草稿](./docs/release/RELEASE_CANDIDATE.md) —— 发布候选检查结果、release notes 和拟定 tag 命令
- [ROADMAP](../docs/product/ROADMAP.md) —— 版本规划与进度

## AI 调用路径

```
React UI ──IPC──▶ Electron Main ──▶ AI Service ──▶ LangGraph.js ──▶ LLM Provider ──▶ SQLite(ai_runs)
```

React 组件不直接调用模型或数据库；一切经 IPC 进入主进程的 LangGraph 工作流。
