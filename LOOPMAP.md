# Production Optimization Loop Map

本文档依据 [LOOPRULE.md](LOOPRULE.md) 编写，用于把“短剧 IP 小说写作工作台”的生产落地优化拆成可执行、可审查、可验证、可提交推送的小闭环。

## 0. 执行约定

- 每个 loop 只完成一个明确目标，避免把无关功能、重构和文档整理混进同一个提交。
- 每个 loop 开始前执行 `git fetch origin` 与 `git status --short --branch`。
- 每个 loop 完成后至少执行 `git diff --check`，并按风险追加 `pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`、`pnpm test`、打包或手工 smoke。
- 每个 loop 必须审查 `git status --short`、`git diff --check`、`git diff`。
- 每个 loop 一个 commit，推送远程并确认本地与远端对齐后，状态才可改为 `done`。
- 若只完成代码但未推送，状态只能为 `partial`。

## 1. Loop 总览

| Loop | Owner | 状态 | 目标 | 主要范围 | 验收 |
| --- | --- | --- | --- | --- | --- |
| L0-01 | Codex/工程负责人 | done | 建立生产优化基线分支与执行基线 | `README.md`、`DEVELOPMENT.md`、`LOOPMAP.md`、项目脚本 | 完成远程同步；记录当前测试基线；确认无凭据/构建产物入库；`pnpm test` 通过或记录阻塞 |
| L1-01 | Codex/数据安全 | done | 强化 SQLite 备份一致性 | `apps/desktop/electron/db.ts`、`packages/db/src/client.ts`、DB 测试 | 备份前执行 checkpoint 或使用 SQLite backup API；覆盖 WAL 场景；新增/扩展 DB smoke；`pnpm test:db` 通过 |
| L1-02 | Codex/数据安全 | done | 增加备份恢复与手动备份入口 | Electron IPC、renderer 设置页/数据页、文档 | 用户可查看备份、手动创建备份、恢复指定备份；恢复前自动二次备份；错误有结构化提示 |
| L1-03 | Codex/数据安全 | done | 项目包导入导出 schema 化与预检 | `packages/export/src/project-package.ts`、`packages/core/src/schemas`、测试 | `.sdnspkg` 解析使用 Zod/schema 校验；导入前显示版本、项目名、数据规模；损坏包/高版本包提示清晰；项目包往返测试通过 |
| L2-01 | Codex/平台安全 | done | 建立 IPC 业务 schema 单一来源 | `packages/core/src/ipc-contract.ts`、`packages/core/src/schemas` | 高风险 create/update/run 通道不再使用裸 `objectPayload`；schema 覆盖项目、章节、模型、视频、模板、创意诊断核心入口；IPC 单测通过 |
| L2-02 | Codex/平台安全 | done | 收紧 IPC fallback 策略 | `packages/core/src/ipc-contract.ts`、IPC 测试 | 未登记 channel 默认拒绝或只允许显式白名单；新增通道必须补 exact schema；测试覆盖未知 channel、错误参数、越权形状 |
| L3-01 | Codex/创作体验 | done | 为 AI 覆写增加 diff 预览 | `packages/ai/src/nodes/save-result.node.ts`、renderer AI 预览组件、内容版本表 | 章节/剧本/镜头 Prompt 覆写前可查看差异；用户确认后写入；取消不会修改正文 |
| L3-02 | Codex/创作体验 | done | 增加版本比较与一键恢复 | `content_versions` repository、Workspace/Script/Shot 页面 | 用户可查看历史版本、比较当前版本、恢复指定版本；恢复操作也生成新版本记录；相关 smoke/单测通过 |
| L3-03 | Codex/创作体验 | done | 明确自动落库任务策略 | AI workflow、prompt registry、UI 文案 | 每类任务标记“预览后采用”或“自动写入”；危险覆写默认走确认；文档与 UI 行为一致 |
| L4-01 | Codex/安全 | done | 加固 API Key 存储降级策略 | `apps/desktop/electron/secrets.ts`、模型/视频设置页 | `safeStorage` 不可用时显示明确警告；可选择拒绝保存或显式降级；不会静默明文落库 |
| L4-02 | Codex/安全 | done | 增加密钥迁移和健康检查 | secrets、设置页、诊断文档 | 能识别明文/加密/掩码状态；启动时迁移可审计；失败不丢 key 且提示可操作 |
| L5-01 | Codex/视频平台 | done | 拆分真实视频 Provider 适配器框架 | `packages/ai/src/providers/video`、`AI_VIDEO_GUIDE.md` | `mock/custom` 与真实平台适配器分离；每个平台有独立鉴权、请求、状态映射、错误归一化接口 |
| L5-02 | Codex/视频平台 | done | 落地首个真实视频平台适配 | video provider、视频设置页、视频任务页 | 至少一个真实平台完成提交、轮询、失败处理、结果保存；可用 mock 测试和真实配置手工 smoke 验证 |
| L5-03 | Codex/视频平台 | done | 视频结果本地归档 | 视频任务服务、DB、文件存储策略 | 可将远端视频/封面保存到本地项目资产目录；记录本地路径与远端 URL；导出项目包策略明确 |
| L6-01 | Codex/任务系统 | done | 引入长任务队列模型 | AI IPC、video service、DB schema/migration | AI/视频长任务有 `pending/running/success/failed/canceled` 状态；任务可恢复查询；迁移与 DB smoke 通过 |
| L6-02 | Codex/任务系统 | done | 支持取消、重试、并发限制 | AI workflow、HTTP provider、UI | 用户可取消运行中任务；失败任务可重试；同类任务并发可配置或有限制；取消不会产生半写入 |
| L6-03 | Codex/任务系统 | done | 批量生成进度持久化 | 剧本批量生成、分镜批量生成、工作流记录 | 批量任务中断后可看到已完成/失败项；重跑只补未完成项；UI 显示进度与错误明细 |
| L7-01 | Codex/AI 基础设施 | done | 上下文 token 预算与裁剪 | `packages/ai/src/context/context-builder.ts`、`load-project-context.node.ts` | 不再无上限拼接长文本；按任务定义上下文预算；超限时使用摘要/最近记录/关键实体；新增测试覆盖大项目 |
| L7-02 | Codex/AI 基础设施 | done | 增加上下文预览与调试导出 | AI run、设置/诊断页 | 用户可查看本次发送给模型的上下文摘要；敏感样本文档仍不写入日志；诊断导出可复现问题 |
| L7-03 | Codex/AI 基础设施 | done | Token/费用预算控制 | 模型配置、AI run summary、UI | 可设置单次/每日 token 或费用提醒；超预算前提示；统计页按模型/任务组展示消耗 |
| L8-01 | Codex/发布工程 | done | 建立 CI 基线 | `.github/workflows`、package scripts、文档 | CI 至少运行 install、typecheck、unit、DB smoke；原生模块缓存策略明确；PR 失败可定位 |
| L8-02 | Codex/发布工程 | done | 建立跨平台打包 smoke | electron-builder、CI、release 文档 | macOS/Windows/Linux 安装包可构建；至少验证应用启动和数据库初始化；产物不包含源码外敏感文件 |
| L8-03 | Codex/发布工程 | done | 完成签名、公证与自动更新设计 | `electron-builder.yml`、发布文档 | mac hardened runtime 配置完整；notarization/签名变量文档化；自动更新源与回滚策略明确 |
| L9-01 | Codex/可观测性 | done | 增加本地日志系统 | Electron main、renderer、AI/video services | 主进程、渲染进程、AI、视频任务写入滚动日志；日志不包含 API Key 或上传原文 |
| L9-02 | Codex/可观测性 | done | 增加诊断包导出 | 设置页/帮助页、日志、环境信息 | 用户可导出诊断包；包含版本、系统、迁移版本、最近错误和脱敏日志；不包含正文/密钥，除非用户显式选择 |
| L9-03 | Codex/稳定性 | done | 增加渲染层 Error Boundary 与崩溃恢复 | `apps/desktop/renderer/src`、main 进程事件 | 页面异常不白屏；提供返回首页/重载/导出诊断；未处理 promise rejection 有日志 |
| L10-01 | Codex/测试 | done | 增加前端 E2E smoke | Playwright 或 Electron 测试工具、核心页面 | 覆盖创建项目、创建章节、模型配置表单、项目包导入导出最小路径；CI 可运行或有本地命令 |
| L10-02 | Codex/测试 | done | 增加 AI workflow mock 回归 | `packages/ai`、tests | 使用 mock provider 覆盖成功、JSON 修复重试、模型失败、空输出、写入内容版本；`pnpm test:unit` 通过 |
| L10-03 | Codex/测试 | done | 增加迁移回放测试 | `packages/db/src/migrator.ts`、fixtures、smoke | 从旧版 fixture 升级到最新 schema；重复迁移幂等；失败迁移回滚可测 |
| L11-01 | Codex/安全 | done | 收紧 Electron 外链与 CSP | `apps/desktop/electron/main.ts`、`apps/desktop/electron/security-policy.ts`、测试 | 默认只允许 HTTPS；localhost/dev 仅开发态；CSP 与图片/媒体来源策略有测试或手工验证记录 |
| L11-02 | Codex/安全 | done | 增加文件导入安全限制 | 项目包导入、样本文档导入、视频素材导入 | 文件大小、扩展名、解析失败、超大文本截断策略统一；错误提示可操作；不会阻塞主进程 |
| L12-01 | Codex/产品体验 | done | 增加质量闸门仪表盘 | Workspace/Adaptation/Script/Shot 页面 | 用户能看到未记忆章节、未审稿剧本、高风险镜头、失败任务；点击可跳转处理 |
| L12-02 | Codex/产品体验 | done | 增加全局搜索 | DB repository、renderer 页面 | 可搜索项目、人物、章节、剧本、场景、镜头 Prompt、AI 记录；大项目响应可接受 |
| L12-03 | Codex/产品体验 | done | 完善完整工作流模板 | creative workflow、template、UI | 从小说到分集、剧本、分镜、视频任务有可复用流水线；每步可暂停、查看结果、重试 |
| L13-01 | Codex/资产管理 | todo | 设计本地资产库 | DB schema、文件目录、导入导出策略 | 角色参考图、场景图、视频结果、封面等有统一资产模型；项目包是否包含资产可配置 |
| L13-02 | Codex/资产管理 | todo | 资产引用接入角色/镜头/视频 | VisualProfile、Shot、VideoResult UI | 角色视觉档案和镜头 Prompt 可引用本地资产；缺失文件有提示；导出/导入能保持引用或说明缺失 |
| L14-01 | Codex/文档 | todo | 修正文档与实现不一致 | `README.md`、`DEVELOPMENT.md`、`CONTRIBUTING.md` | 移除过期 `ensureSchema()` 表述；命令、路径、迁移说明与当前代码一致；`git diff --check` 通过 |
| L14-02 | Codex/文档 | todo | 增加用户手册与故障排查 | 新增用户文档、README 索引 | 覆盖安装、模型配置、备份恢复、项目包、AI 失败、视频平台配置、日志诊断 |
| L15-01 | Codex/Release | todo | Release Candidate 全量闸门 | 全仓、CI、打包产物、文档 | `pnpm test` 通过；跨平台打包 smoke 通过；安全检查通过；文档状态更新；tag/release note 草稿完成 |

## 2. 推荐执行批次

### Batch A：上线前硬门槛

优先执行：

1. L1-01：SQLite 一致性备份。
2. L2-01：IPC 业务 schema。
3. L3-01：AI 覆写 diff 预览。
4. L4-01：API Key 降级保护。
5. L8-01：CI 基线。

该批次完成后，项目从“本地可用”进入“可控发版”的基础状态。

### Batch B：真实用户闭环

优先执行：

1. L1-02：备份恢复入口。
2. L3-02：版本比较与恢复。
3. L6-01：长任务队列模型。
4. L7-01：上下文 token 预算。
5. L9-01：本地日志系统。
6. L10-02：AI workflow mock 回归。

该批次完成后，真实创作者长时间使用时的安全感会明显提升。

### Batch C：商业/公开发布闭环

优先执行：

1. L5-01 / L5-02：真实视频平台适配。
2. L8-02 / L8-03：打包、签名、公证、自动更新。
3. L9-02：诊断包导出。
4. L10-01：E2E smoke。
5. L15-01：RC 全量闸门。

该批次完成后，才适合面向外部用户稳定发布。

### Batch D：效率与体验增强

优先执行：

1. L12-01：质量闸门仪表盘。
2. L12-02：全局搜索。
3. L12-03：完整工作流模板。
4. L13-01 / L13-02：本地资产库。
5. L14-02：用户手册。

该批次主要提升留存、效率和规模化创作体验。

## 3. 验证策略

| 变更类型 | 最小验证 | 扩展验证 |
| --- | --- | --- |
| 文档-only | `git diff --check` | 人工检查路径、命令、链接 |
| IPC/schema | `pnpm test:unit` | `pnpm typecheck`、关键页面手工 smoke |
| DB/migration | `pnpm test:db` | `pnpm test`、旧库 fixture 回放 |
| AI workflow | `pnpm test:unit` | mock provider 端到端、失败/重试/空输出测试 |
| Electron 安全/主进程 | `pnpm typecheck` | 启动 smoke、CSP/外链手工验证 |
| UI/体验 | `pnpm typecheck` | E2E smoke、桌面/窄屏截图检查 |
| 打包发布 | `pnpm test` | `pnpm package`、安装包启动 smoke |

## 4. 完成定义

每个 loop 状态更新为 `done` 前，必须满足：

1. 目标已实现，且范围没有扩散。
2. 验收标准逐项满足。
3. 本地验证通过。
4. `git diff --check` 通过。
5. diff 已人工审查。
6. 已创建单独 commit。
7. 已再次同步远程并处理远端新提交。
8. 合并后必要验证已重跑。
9. 已推送远程。
10. `git status --short --branch` 显示本地与远端对齐。

## 5. 当前基线记录

- 当前已知测试基线：`pnpm typecheck`、`pnpm test:unit`（65 个单元测试）、`pnpm test:db` 可通过；DB smoke 会先重编 `better-sqlite3` 到 Node ABI，执行迁移回放与 DB smoke，结束后重编回 Electron ABI。
- 现有明显缺口：E2E 已有最小 Electron smoke 但覆盖仍需扩展，自动更新运行时代码尚未接入，长任务跨会话自动续跑策略仍需补齐；真实视频平台已落地 OpenAI Sora，其他平台仍需专用实现。
- 当前文档状态：已按执行日志更新 L0-01、L1-01、L1-02、L1-03、L2-01、L2-02、L3-01、L3-02、L3-03、L4-01、L4-02、L5-01、L5-02、L5-03、L6-01、L6-02、L6-03、L7-01、L7-02、L7-03、L8-01、L8-02、L8-03、L9-01、L9-02、L9-03、L10-01、L10-02、L10-03、L11-01、L11-02、L12-01、L12-02、L12-03 状态；其余 loop 仍为 `todo`。

## 6. Loop 执行日志

### L0-01：生产优化基线

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 当前工作区注意事项：`UPDATE.md` 在本轮开始前已处于删除状态；该删除不属于 L0-01 范围，本 loop 不纳入提交。
- 本 loop 范围：仅更新 `LOOPMAP.md` 中的基线记录与执行状态。
- 本地验证：`git diff --check` 通过；`pnpm test` 通过（typecheck、13 个单元测试、DB smoke，结束后已重编 `better-sqlite3` 回 Electron ABI）。
- Diff 审查：仅包含 `LOOPMAP.md` 的 loop 规划与 L0-01 基线记录；未纳入 `UPDATE.md` 删除状态。

### L1-01：SQLite 一致性备份

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`packages/db/src/client.ts`、`apps/desktop/electron/db.ts`、`scripts/smoke-db.ts`、`LOOPMAP.md`。
- 实现结果：新增 `backupSqliteDatabase()`，备份时先 checkpoint WAL，再用 SQLite `VACUUM INTO` 生成可独立打开的快照；桌面端启动备份改用该函数。
- 本地验证：`git diff --check` 通过；`pnpm --filter @sdns/db typecheck` 通过；`pnpm --filter @sdns/desktop typecheck` 通过；`pnpm test:db` 通过，并覆盖一致性备份可恢复读取。
- Diff 审查：变更限定在 DB client、桌面启动备份、DB smoke 和本 loop 文档状态。

### L1-02：备份恢复与手动备份入口

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`packages/db/src/client.ts`、`apps/desktop/electron/db.ts`、`apps/desktop/electron/ipc/data-backup.ipc.ts`、`apps/desktop/electron/preload.ts`、`apps/desktop/renderer/src/pages/DataSettingsPage.tsx`、设置页/路由、renderer IPC 类型、IPC 合约与单测、DB smoke、`LOOPMAP.md`。
- 实现结果：新增数据库恢复工具，恢复主库时清理旧 WAL/SHM；主进程提供备份列表、手动备份、恢复指定备份 IPC；恢复前自动创建 `pre_restore` 安全备份并重新打开数据库；设置页新增“数据与备份”入口，支持查看备份、手动备份和恢复。
- 本地验证：`git diff --check`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db` 已纳入本 loop 验证。
- Diff 审查：变更限定在备份恢复工具、受控 IPC、数据设置页、IPC schema/test、DB smoke 和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L2-01：IPC 业务 schema 单一来源

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`packages/core/src/ipc-contract.ts`、`tests/ipc-contract.test.ts`、`LOOPMAP.md`。
- 实现结果：为项目、章节、人物、大纲、模型、视频 Provider/任务/结果、模板、Agent、编剧室、类型预设、创意工作流、修稿任务、内容版本、样本库等高风险 create/update/run 通道建立业务字段 schema；枚举值复用 core 常量；保留 `passthrough` 兼容现有扩展字段。
- 本地验证：`pnpm typecheck` 通过；`pnpm test:unit` 通过（14 个单元测试），并新增高风险 IPC payload 拦截用例；`git diff --check` 通过。
- Diff 审查：变更限定在 IPC 合约、IPC 单测和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L3-01：AI 覆写 diff 预览

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`packages/ai/src/nodes/save-result.node.ts`、`packages/ai/src/persistence.ts`、`packages/ai/src/prompts/task-types.ts`、`packages/core/src/types/index.ts`、`packages/core/src/ipc-contract.ts`、`apps/desktop/renderer/src/components/TextDiffPreviewDialog.tsx`、章节/剧本/镜头相关 renderer 页面、`tests/save-result-preview.test.ts`、`LOOPMAP.md`。
- 实现结果：章节正文、已有剧本正文、镜头 Prompt 的 AI 覆写任务先返回 `text_preview`；renderer 展示逐行 diff，用户采用后才通过 `ai:applyResult` 写库并创建内容版本/Prompt 版本；取消不会修改正文。批量剧本生成只补未生成集，避免批量路径覆盖已有剧本。
- 本地验证：`pnpm typecheck` 通过；`pnpm test:unit` 通过（17 个单元测试），新增测试覆盖预览不落库和采用后写入；`git diff --check` 通过。
- Diff 审查：变更限定在 AI 覆写预览、采用落库、renderer diff 弹窗、IPC 类型/schema 放宽和本 loop 单测；未纳入 `UPDATE.md` 删除状态。

### L3-02：版本比较与一键恢复

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 本 loop 范围：`packages/core/src/types/index.ts`、`packages/core/src/ipc-contract.ts`、`packages/db/src/schema.ts`、`packages/db/src/repositories/creative.repo.ts`、`apps/desktop/electron/ipc/creative.ipc.ts`、`apps/desktop/electron/preload.ts`、renderer IPC 类型、`ContentVersionPanel`、章节/剧本/镜头页面、IPC 单测、DB smoke、`LOOPMAP.md`。
- 实现结果：新增 `contentVersion:restore` IPC；章节/剧本/镜头可查看内容版本、与当前内容做逐行差异比较并恢复指定版本；恢复前自动写入当前内容检查点，恢复后写入 `restore` 来源的新内容版本；镜头恢复同步追加 Prompt 版本快照。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（17 个单元测试）；`pnpm test:db` 通过，并覆盖 `contentVersion` 按 id 查询。
- Diff 审查：变更限定在内容版本恢复服务、版本比较 UI、IPC/schema/test、DB smoke 和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L4-01：API Key 降级保护

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`apps/desktop/electron/secrets.ts`、`apps/desktop/electron/ipc/security.ipc.ts`、`apps/desktop/electron/preload.ts`、`apps/desktop/renderer/src/pages/ModelSettingsPage.tsx`、`apps/desktop/renderer/src/pages/VideoProviderSettingsPage.tsx`、renderer IPC 类型、IPC 合约与单测、`LOOPMAP.md`。
- 实现结果：`safeStorage` 不可用时默认拒绝保存 API Key；用户在模型/视频 Provider 设置页显式勾选后才允许以 `plain:v1:` 降级格式保存；设置页显示明确警告；启动时仅在安全存储可用时自动迁移既有密钥。
- 本地验证：`pnpm typecheck` 通过；`pnpm test:unit` 通过（17 个单元测试），并把安全存储状态 IPC 纳入 exact schema 清单；`git diff --check` 通过。
- Diff 审查：变更限定在密钥保护策略、只读安全状态 IPC、模型/视频设置页降级确认和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L4-02：密钥迁移和健康检查

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当时 `main` 与 `origin/main` 对齐；凭据恢复后再次 `git fetch origin` 成功，远端无新提交；完成后提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L4-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`apps/desktop/electron/secrets.ts`、密钥健康工具、数据库启动迁移日志、`security` IPC、模型/视频设置页健康提示、renderer IPC 类型、`DEVELOPMENT.md`、密钥健康单测、`LOOPMAP.md`。
- 实现结果：新增 `enc:v1:`、`plain:v1:`、`masked:v1:`、旧版裸明文和不可读加密值识别；启动时在安全存储可用时只迁移可逆明文，单项失败保留原值并写入脱敏迁移摘要；设置页展示聚合健康计数和可操作提示；诊断文档说明密钥状态和迁移审计策略。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（33 个单元测试）；`git diff --check` 通过。`pnpm typecheck` 在本机依赖恢复时卡在 Electron postinstall，已用等价桌面 tsconfig 编译替代。
- Diff 审查：变更限定在密钥健康/迁移、设置页提示、诊断文档、单测和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L5-01：真实视频 Provider 适配器框架

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L5-01 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`packages/ai/src/providers/video`、`packages/ai/src/index.ts`、`tests/video-provider-adapter.test.ts`、`AI_VIDEO_GUIDE.md`、`LOOPMAP.md`。
- 实现结果：新增 `VideoProviderAdapter` 边界与 HTTP transport；`custom` 使用 OpenAI-compatible 风格 adapter；即梦、可灵、海螺、Runway、Pika、Sora 均有独立 adapter 注册位、鉴权/请求/状态映射/错误归一化接口，未填真实 API 映射前返回明确未启用错误；工厂不再把真实平台误路由到 custom 通用端点。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/video-provider-adapter.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（36 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在视频 Provider adapter 框架、导出、指南、adapter 单测和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L5-02：落地首个真实视频平台适配

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L5-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`packages/ai/src/providers/video/adapters.ts`、视频生成服务、视频 Provider 设置页、adapter/service 单测、`AI_VIDEO_GUIDE.md`、`LOOPMAP.md`。
- 实现结果：`openai_sora` adapter 接入 OpenAI 官方视频接口；创建任务使用 `POST /videos`，轮询使用 `GET /videos/{video_id}`，状态映射覆盖 `queued`、`in_progress`、`completed`、`failed`，失败消息归一化；完成后保存 `/videos/{video_id}/content` 结果端点和原始 metadata；视频服务保留 provider 提交阶段返回的 `failed` 状态；设置页选择 Sora 时自动带出官方 Base URL、默认模型和 `size/seconds` 参数。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/video-generation-service.test.ts tests/video-provider-adapter.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（38 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在 OpenAI Sora adapter、提交失败态保存、设置页默认配置、视频指南、adapter/service 单测和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L5-03：视频结果本地归档

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L5-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`VideoResult` 类型/schema/migration/repository、视频生成服务、Electron 视频归档器、视频任务 IPC、视频结果 UI、DB smoke、service 单测、`AI_VIDEO_GUIDE.md`、`LOOPMAP.md`。
- 实现结果：新增 video_results v7 本地资产字段；视频服务支持 `videoAssetArchiver` 注入，成功结果落库前可归档远端视频/封面；Electron 主进程将 http(s)/file 资源保存到 `userData/assets/projects/<projectId>/video-results/<taskId>/`，OpenAI Sora content endpoint 下载时临时附加 Bearer Key；UI 优先播放本地 `file://` 资源并展示远端 URL/归档错误；项目包策略明确为当前不内嵌视频二进制资产，后续资产库 loop 再做可选随包携带。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/video-generation-service.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（39 个单元测试）；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/smoke-db.ts` 通过；`git diff --check` 通过。
- Diff 审查：变更限定在视频资产归档、DB 字段/迁移、视频结果 UI、归档策略文档、service 单测和 DB smoke；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L6-01：长任务队列模型

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 本 loop 范围：`packages/core/src/types/index.ts`、`packages/db/src/schema.ts`、`packages/db/src/migrations.ts`、`packages/db/src/migrator.ts`、`packages/db/src/repositories/long-task.repo.ts`、`packages/db/src/index.ts`、AI/视频 IPC、preload、renderer IPC 类型、任务队列设置页、IPC 单测、DB smoke、`LOOPMAP.md`。
- 实现结果：新增 `long_tasks` 通用任务账本和 v6 迁移；AI `run/runStream` 与视频提交/轮询/重试写入统一任务状态；状态模型覆盖 `pending/running/success/failed/canceled`；设置页新增任务队列，可恢复查看 AI/视频长任务并本地标记取消；视频任务状态扩展 `canceled`。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（17 个单元测试）；`pnpm test:db` 通过，并覆盖 long task CRUD、状态流转和项目删除级联。
- Diff 审查：变更限定在长任务模型、迁移、AI/video 任务记录、任务队列查询 UI、IPC schema/test、DB smoke 和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L6-02：支持取消、重试、并发限制

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L6-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：AI workflow cancel signal、AI/video IPC、长任务 runtime、任务监控页、preload/renderer IPC 类型、IPC schema/test、runtime 单测、`LOOPMAP.md`。
- 实现结果：新增主进程 long task runtime，AI/视频本地运行各限制 1 个并发；AI workflow 节点接入 AbortSignal，取消后停止后续落库节点；视频提交/重试在取消后不再把长任务回写成成功；任务队列可取消运行中任务、可重试失败任务；新 AI long task 保存可重试输入快照，旧任务缺少快照时提示回到原页面重跑。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/task-runtime.test.ts tests/ipc-contract.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（40 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在长任务取消/重试/并发控制、AI workflow 取消信号、任务监控 UI、IPC schema/test 和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L6-03：批量生成进度持久化

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L6-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：批量任务进度模型、长任务 runtime、任务 IPC、AI IPC 父级取消信号、preload/renderer IPC 类型、剧本页批量生成、分镜页批量拆镜头、任务队列明细 UI、IPC/批量进度单测、`LOOPMAP.md`。
- 实现结果：新增 `batch` 长任务类型和批量进度结构；剧本批量生成由前端循环改为主进程批量父任务，按集持久化 `pending/running/success/failed/skipped/canceled` 明细；分镜页新增“批量拆分镜头”，按场景补齐缺失镜头并跳过已有镜头；任务队列展示批量进度条、成功/失败/跳过统计和失败项错误；失败/取消的批量任务可继续执行，只重置未完成项，已成功/已跳过项不会重复写入。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/batch-progress.test.ts tests/ipc-contract.test.ts tests/task-runtime.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（42 个单元测试）；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/smoke-db.ts` 通过；`git diff --check` 通过。
- Diff 审查：变更限定在批量任务进度持久化、剧本/分镜批量入口、任务队列明细、IPC schema/test 和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L7-01：上下文 token 预算与裁剪

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 本 loop 范围：`packages/ai/src/context/context-builder.ts`、`packages/ai/src/nodes/build-prompt.node.ts`、上下文预算单测、`LOOPMAP.md`。
- 实现结果：新增任务级上下文 token 预算、粗略 token 估算和首尾保留裁剪；build prompt 出口统一应用预算；聊天上下文保留最近轮次，人物/章节/分集/场景/镜头等长列表加数量上限，避免大项目无限拼接。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（19 个单元测试），新增大项目上下文裁剪与聊天历史裁剪测试。
- Diff 审查：变更限定在上下文构建、prompt 出口预算应用、预算单测和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L7-02：上下文预览与调试导出

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L7-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：AI run repository/IPC、上下文预览脱敏 helper、preload/renderer IPC 类型、设置页 AI 诊断入口、上下文预览弹窗、诊断页调试 JSON 导出、IPC/预览 helper 单测、`LOOPMAP.md`。
- 实现结果：新增 AI run 最近记录、上下文预览和调试导出 IPC；上下文预览从 `ai_runs.input` 解析 `# 输入材料`，按 `##` 分段展示字符数、粗略 token 与片段摘要，并对 API Key/Bearer 等敏感串脱敏；样本文档抽取仍只保存既有占位提示，不把上传原文写入 AI 记录/日志；设置页新增 AI 诊断页，可查看最近调用上下文摘要并显式导出可复现问题的调试 JSON。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/ai-context-preview.test.ts tests/ipc-contract.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（44 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在 AI 上下文预览/诊断导出、设置页入口、IPC schema/test 和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L7-03：Token/费用预算控制

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L7-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：AI 预算设置表/仓储/迁移、AI run token/费用汇总、模型设置页预算表单、用量统计页模型/任务组明细、模型调用前预算拦截、IPC schema/test、预算单测、DB smoke、`LOOPMAP.md`。
- 实现结果：新增全局 Token/费用预算设置，支持单次与每日 token 上限、单次与每日费用上限、每千 tokens 估价与币种；模型调用前先估算 prompt token 与当日已用量，超预算时返回“预算提醒”并避免真实 provider 调用；统计页新增按模型/任务组的 token、成功/失败和费用估算明细。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/ai-budget.test.ts tests/ipc-contract.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（46 个单元测试）；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/smoke-db.ts` 通过；`git diff --check` 通过。
- Diff 审查：变更限定在 AI 预算设置、预算前置拦截、用量汇总 UI、IPC schema/test、预算单测、DB smoke 和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L8-01：CI 基线

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 本 loop 范围：`.github/workflows/ci.yml`、`LOOPMAP.md`。
- 实现结果：新增 GitHub Actions CI，push/PR 触发；使用 Node 22 与 pnpm 11.2.2；缓存 pnpm store、Electron 下载缓存、electron-builder 缓存与 `better-sqlite3` 原生模块路径；依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（17 个单元测试）；`pnpm test:db` 通过（沙箱内因 node-gyp/electron-gyp 用户缓存权限失败，已按规则在沙箱外重跑通过）。
- Diff 审查：变更限定在 CI 工作流和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L8-02：跨平台打包 smoke

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已确认 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L8-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：GitHub Actions 打包 smoke 矩阵、`scripts/package-smoke.mjs`、Electron 主进程 smoke 启动模式、`electron-builder.yml` asar 解包边界、zod 打包运行时兼容、发布/开发文档、`LOOPMAP.md`。
- 实现结果：新增 `package-smoke` CI job，在 macOS/Windows/Linux 原生 runner 上运行本平台安装包构建；新增本地/CI 共用的 package smoke 脚本，检查预期安装包、`app.asar`/`app.asar.unpacked` 禁止项，并通过 Electron runner 加载 packaged `app.asar`，使用临时 `userData` 验证主进程启动与 `studio.db` 初始化；主进程新增仅 smoke 环境/参数触发的无窗口启动出口；`asarUnpack` 收紧为只解包 `.node` 二进制；workspace zod 统一到 `3.25.32`，修复 packaged runtime 中 `zod/v3` 子路径不可解析的问题。
- 本地验证：`pnpm install --frozen-lockfile --offline --ignore-scripts` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/ai/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（46 个单元测试）；`node scripts/package-smoke.mjs --dir` 通过；`node scripts/package-smoke.mjs --skip-build` 通过并生成 macOS `.dmg`/`.zip` 后完成 DB 初始化 smoke；`node scripts/rebuild-better-sqlite3-node.mjs`、`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/smoke-db.ts`、`node_modules/.bin/electron-rebuild -f -w better-sqlite3` 通过；`git diff --check` 通过。
- Diff 审查：变更限定在打包 smoke、CI 发布关卡、主进程 smoke 出口、打包依赖兼容、发布文档和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；本地 `dist` 产物和 node_modules 修复不纳入提交。

### L8-03：签名、公证与自动更新设计

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已确认 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L8-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`electron-builder.yml` mac hardened runtime/entitlements/afterSign 配置、mac entitlements 文件、notarize hook、`RELEASE.md` 签名/公证/自动更新与回滚策略、`LOOPMAP.md`。
- 实现结果：macOS 打包配置补齐 entitlements 与 `afterSign` 公证 hook；hook 在缺少 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 时 no-op，避免影响本地和 PR smoke；发布文档明确 macOS/Windows 签名变量、Apple notarization 变量、generic HTTPS 更新源目录、stable/beta 通道和 metadata 回滚策略；`publish` 源改为明确的 generic HTTPS 占位源，真实发布环境需覆盖为公司控制域名。
- 本地验证：`node --check scripts/notarize-mac.cjs` 通过；`node scripts/package-smoke.mjs --dir --skip-build` 通过，日志显示 `[notarize] skipped` 且 packaged `app.asar` 完成临时 `studio.db` 初始化；`git diff --check` 通过。
- Diff 审查：变更限定在签名/公证设计配置、notarize hook、发布策略文档和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含任何证书、密码、token 或真实更新源密钥。

### L9-01：本地日志系统

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 本 loop 范围：Electron 主进程本地滚动日志、renderer 日志 IPC、AI/视频任务关键事件日志、IPC schema/test、`LOOPMAP.md`。
- 实现结果：新增 `userData/logs/studio.log` JSON Lines 滚动日志；主进程记录启动、窗口加载失败和进程异常；renderer 未处理异常通过 `log:renderer` 上报脱敏元信息；AI `run/runStream` 与视频提交/轮询/重试记录开始、完成和失败事件；日志写入统一脱敏 API Key、Bearer token、prompt/content/raw/text 等正文类字段。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（19 个单元测试），新增日志 IPC schema 校验用例。
- Diff 审查：变更限定在本地日志系统、受控日志 IPC、AI/video 任务日志、renderer 异常上报、IPC schema/test 和本 loop 文档状态；未纳入 `UPDATE.md` 删除状态。

### L9-02：诊断包导出

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L9-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：诊断包生成 helper、Electron 诊断 IPC、日志读取与二次脱敏、数据库迁移快照、preload/renderer IPC 类型、诊断设置页、IPC/诊断单测、`LOOPMAP.md`。
- 实现结果：设置页“诊断与日志”可导出 `.sdnsdiag.json` 诊断包；包内包含应用版本、系统环境、数据库路径脱敏、迁移最新/已应用版本、最近错误和最近脱敏日志；默认排除正文、Prompt、AI 输入输出、raw/text 类字段和密钥；用户显式勾选后仅保留最近日志中的正文类字段片段，并仍对 API Key、Bearer、密码、cookie、token 等密钥二次脱敏。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/diagnostics.test.ts tests/ipc-contract.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（50 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在诊断包导出、脱敏测试、IPC schema/test、诊断设置页和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含密码、token、证书或构建产物。

### L9-03：渲染层 Error Boundary 与崩溃恢复

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L9-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：renderer 根入口、Error Boundary 组件、运行时错误元信息 helper、错误元信息单测、`LOOPMAP.md`。
- 实现结果：React 渲染异常由全局 Error Boundary 捕获，页面显示恢复界面而不是白屏；恢复界面提供返回首页、重载页面、导出诊断包；Boundary 捕获的错误写入 renderer 日志且只记录类型、消息长度、栈帧和组件栈帧；既有 `error`/`unhandledrejection` 全局监听继续使用同一套脱敏元信息。
- 本地验证：`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/renderer-runtime-errors.test.ts tests/diagnostics.test.ts` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（53 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在 renderer 崩溃恢复、错误日志脱敏 helper、相关单测和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含密码、token、证书或构建产物。

### L10-01：前端 E2E smoke

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L10-01 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：Electron E2E smoke 主进程模式、E2E runner 脚本、根脚本入口、README/DEVELOPMENT 命令说明、`LOOPMAP.md`。
- 实现结果：新增 `pnpm test:e2e`，自动构建桌面端、重编 `better-sqlite3` 到 Electron ABI、启动真实 Electron renderer，并驱动最小用户路径：进入创建项目页、创建项目、创建章节、进入模型设置页、提交模型配置表单；同一 smoke 还通过 `@sdns/export` 做项目包序列化、预览和导入往返，校验导入项目含章节；新增 `pnpm test:e2e:skip-build` 用于复用既有构建产物快速调试。
- 本地验证：`node --check scripts/e2e-smoke.mjs` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` 通过；`apps/desktop/node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.web.json` 通过；`pnpm test:e2e` 通过（构建 + Electron E2E smoke + 项目包往返）；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/**/*.test.ts` 通过（53 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在 Electron E2E smoke、脚本入口、测试命令文档和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含测试产物、用户数据、密码、token 或证书。

### L10-02：AI workflow mock 回归

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L10-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`tests/ai-workflow-mock.test.ts`、`LOOPMAP.md`。
- 实现结果：新增 mock AI workflow 回归夹具，复用真实 JSON parser、`GenerateProjectResultSchema`、`saveAiRun` 节点和采用落库 service；覆盖成功 JSON 任务、JSON 解析失败后一轮修复重试、模型调用失败记账、空文本输出失败、采用项目生成结果并写入内容版本。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（24 个单元测试）。
- Diff 审查：变更限定在 AI workflow mock 回归测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L10-03：迁移回放测试

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L10-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：旧库 SQL fixture、迁移回放 DB 测试、DB smoke 脚本、`LOOPMAP.md`。
- 实现结果：新增 `legacy-v0.1.sql` fixture，覆盖旧版项目/人物/章节/评分/改编项目/视频结果表；迁移回放测试验证无 `schema_migrations` 的旧库可一次升级到最新版本、旧数据保留、旧表缺失列补齐、v3/v6/v8 等版本迁移生效；重复运行 `runMigrations` 返回空数组；新增失败迁移注入用例，确认迁移事务回滚且失败版本不会写入 `schema_migrations`。
- 本地验证：`pnpm test:db` 通过，流程内先重编 `better-sqlite3` 到 Node ABI，执行 `tests/db-migration-replay.db.ts` 与 `scripts/smoke-db.ts`，结束后重编回 Electron ABI；`git diff --check` 通过。
- Diff 审查：变更限定在迁移 fixture、迁移回放/回滚 DB 测试、DB smoke 脚本和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含二进制 SQLite、构建产物、密码、token 或证书。

### L11-01：Electron 外链与 CSP 收紧

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L11-01 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`apps/desktop/electron/main.ts`、`apps/desktop/electron/security-policy.ts`、`tests/electron-security-policy.test.ts`、`LOOPMAP.md`。
- 实现结果：新增可测安全策略 helper，生产态外链仅允许 HTTPS；开发态仅额外允许 loopback HTTP；主进程窗口打开和导航统一走同一策略；CSP 生产态移除 HTTP/WS localhost 开口，仅允许 `self`、HTTPS、data 和 file 图片/媒体来源；开发态只为 localhost/127.0.0.1/[::1] 放开本地连接、图片和媒体来源。
- 本地验证：`pnpm --filter @sdns/desktop typecheck` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/electron-security-policy.test.ts` 通过（4 个安全策略测试）；`pnpm test:unit` 通过（57 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在 Electron 外链/CSP 策略、主进程调用点、安全策略测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含密码、token、证书或构建产物。

### L11-02：文件导入安全限制

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L11-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`apps/desktop/electron/file-security.ts`、项目包导入 IPC、样本文档导入 IPC、视频素材归档、`tests/file-import-security.test.ts`、`LOOPMAP.md`。
- 实现结果：新增统一文件导入策略，项目包限制为 `.sdnspkg/.json` 且最大 20MB；样本文档限制为 `.md/.txt/.docx` 且最大 10MB，文本仍统一截断到 80,000 字符；视频素材限制为常见视频/图片扩展且最大 300MB；项目包和样本文档读取前先异步 stat/扩展名校验；本地 `file://` 视频素材复制前校验；远程视频素材按响应扩展/类型和 `content-length` 预检，写盘前再按实际字节数复核。
- 本地验证：`pnpm --filter @sdns/desktop typecheck` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/file-import-security.test.ts` 通过（3 个导入安全测试）；`pnpm test:unit` 通过（60 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在文件导入安全 helper、三个导入/归档入口、导入安全测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含二进制文件、构建产物、密码、token 或证书。

### L12-01：质量闸门仪表盘

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L12-01 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：工作台导航常量、`WorkspacePage`、质量闸门面板组件、质量闸门纯判断 helper、单测、`LOOPMAP.md`。
- 实现结果：工作台新增“质量闸门”入口；面板聚合章节记忆、改编项目、剧本审稿、镜头审查和长任务数据；展示未生成章节记忆、已有正文但未审稿剧本、高难度/低分镜头、失败长任务；按阻塞/提醒计数；每条待办可跳转到记忆面板、剧本页、分镜页或任务监控页；面板支持刷新且不新增数据库迁移。
- 本地验证：`pnpm --filter @sdns/desktop typecheck` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/quality-gate-dashboard.test.ts` 通过（3 个质量闸门 helper 测试）；`pnpm test:unit` 通过（63 个单元测试）；`git diff --check` 通过。
- Diff 审查：变更限定在质量闸门 UI、导航常量、可测聚合 helper、测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含数据库迁移、构建产物、密码、token 或证书。

### L12-02：全局搜索

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L12-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：core 搜索结果类型、DB 搜索 repository、IPC contract/preload/renderer API、搜索页、首页入口、工作台搜索定位参数、DB smoke、`LOOPMAP.md`。
- 实现结果：新增 `search:global` IPC，按项目、人物、章节、剧本、场景、镜头 Prompt、AI 记录分组执行 DB 侧 LIKE 查询并限制每类返回数量；结果携带标题、摘要片段、类型、route 和更新时间；首页新增“搜索”入口；新增 `/search` 页面，支持 URL query、延迟查询、分组结果和点击跳转；项目工作台识别 `section/chapter` 参数，可从搜索结果跳到章节/AI 记录等工作区。
- 本地验证：`pnpm typecheck` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/ipc-contract.test.ts` 通过；`pnpm test:unit` 通过（63 个单元测试）；`pnpm test:db` 通过，新增全局搜索 DB smoke 断言覆盖人物、章节、剧本、场景、镜头 Prompt、AI 记录，并在结束后重编 `better-sqlite3` 回 Electron ABI；`git diff --check` 通过。
- Diff 审查：变更限定在全局搜索数据入口、受控 IPC、搜索 UI、工作台定位和 DB smoke；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含数据库迁移、构建产物、密码、token 或证书。

### L12-03：完整工作流模板

- 状态：done
- 目标分支：`main`
- 远程同步：开始前已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L12-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：创意工作流模板定义、workflow IPC 执行器、批量任务复用入口、renderer 创意诊断台、IPC contract、模板单测、DB schema 类型、`LOOPMAP.md`。
- 实现结果：新增“小说到视频任务流水线”，覆盖改编前质量闸门、分集大纲、批量剧本、批量分镜和视频任务草稿；工作流步骤支持 `ai/batch/video_tasks` 三类执行；分集、剧本、分镜和视频任务交接点可暂停检查；新增 `workflow:resume` 与 `workflow:retryStep`，可从暂停或失败步骤继续；步骤记录保存 AI run、长任务或视频任务 ID；创意诊断台展示模板说明、单步运行、步骤状态、查看结果、继续和重试；视频步骤只创建 pending 草稿，不自动提交真实视频平台。
- 本地验证：`pnpm typecheck` 通过；`node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs --test tests/ipc-contract.test.ts tests/creative-workflow-templates.test.ts` 通过；`pnpm test:unit` 通过（65 个单元测试）；`pnpm test:db` 通过，并在结束后重编 `better-sqlite3` 回 Electron ABI；`git diff --check` 通过。
- Diff 审查：变更限定在完整工作流模板、执行/恢复/重试、批量任务复用、创意诊断台、IPC schema/test 和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态；不包含构建产物、密码、token 或证书。

### L1-03：项目包导入导出 schema 化与预检

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L1-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`packages/core/src/schemas/index.ts`、`packages/export/src/project-package.ts`、`packages/export/src/index.ts`、`apps/desktop/electron/ipc/export.ipc.ts`、`tests/project-package.test.ts`、`LOOPMAP.md`。
- 实现结果：新增项目包 Zod schema；序列化和解析统一走 schema 校验；损坏 JSON、格式不匹配、结构缺字段和高版本包返回清晰错误；新增项目包预检摘要，导入前通过原生确认框显示版本、项目名和数据规模。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（27 个单元测试），覆盖项目包序列化/解析往返、预检计数、损坏包、结构错误和高版本包。
- Diff 审查：变更限定在项目包 schema/预检、桌面导入确认、项目包测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L2-02：收紧 IPC fallback 策略

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L2-02 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`packages/core/src/ipc-contract.ts`、`tests/ipc-contract.test.ts`、`LOOPMAP.md`。
- 实现结果：移除基于 action 名称的隐式 IPC fallback；保留现有低风险通道的显式 fallback 白名单；未登记 channel 默认拒绝；单测扫描所有 Electron `ipcMain.handle` 注册点，确保新增通道必须补共享 schema。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（28 个单元测试），覆盖未知 channel、伪装 create channel、错误参数形状和注册通道 schema 完整性。
- Diff 审查：变更限定在 IPC 合约 fallback 收紧、IPC 单测和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。

### L3-03：自动落库任务策略

- 状态：done
- 目标分支：`main`
- 远程同步：已执行 `git fetch origin`，当前 `main` 与 `origin/main` 对齐后开始；完成后再次同步、提交并推送。
- 当前工作区注意事项：以用户更新后的最新 `LOOPRULE.md` 为准执行；该文件的未提交修改不属于 L3-03 范围，本 loop 不纳入提交；`UPDATE.md` 删除状态同样不纳入提交。
- 本 loop 范围：`packages/core/src/constants/index.ts`、`packages/ai/src/prompts/loader.ts`、`packages/ai/src/index.ts`、章节/剧本 AI UI、任务注册单测、`LOOPMAP.md`。
- 实现结果：新增 `TASK_WRITE_POLICIES` 覆盖所有 `NovelTaskType`，区分预览后采用、条件确认、自动写入和仅返回结果；AI prompt registry 暴露策略查询；章节与剧本 UI 的按钮/完成提示显示实际落库策略；危险正文/剧本/镜头覆写任务保持预览确认路径。
- 本地验证：`git diff --check` 通过；`pnpm typecheck` 通过；`pnpm test:unit` 通过（29 个单元测试），新增所有 taskType 必须声明写入策略的覆盖测试。
- Diff 审查：变更限定在任务写入策略常量、AI registry 查询、章节/剧本 UI 文案、任务注册测试和本 loop 文档状态；未纳入 `LOOPRULE.md` 用户规则更新和 `UPDATE.md` 删除状态。
