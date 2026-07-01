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
| L1-02 | Codex/数据安全 | todo | 增加备份恢复与手动备份入口 | Electron IPC、renderer 设置页/数据页、文档 | 用户可查看备份、手动创建备份、恢复指定备份；恢复前自动二次备份；错误有结构化提示 |
| L1-03 | Codex/数据安全 | todo | 项目包导入导出 schema 化与预检 | `packages/export/src/project-package.ts`、`packages/core/src/schemas`、测试 | `.sdnspkg` 解析使用 Zod/schema 校验；导入前显示版本、项目名、数据规模；损坏包/高版本包提示清晰；项目包往返测试通过 |
| L2-01 | Codex/平台安全 | todo | 建立 IPC 业务 schema 单一来源 | `packages/core/src/ipc-contract.ts`、`packages/core/src/schemas` | 高风险 create/update/run 通道不再使用裸 `objectPayload`；schema 覆盖项目、章节、模型、视频、模板、创意诊断核心入口；IPC 单测通过 |
| L2-02 | Codex/平台安全 | todo | 收紧 IPC fallback 策略 | `packages/core/src/ipc-contract.ts`、IPC 测试 | 未登记 channel 默认拒绝或只允许显式白名单；新增通道必须补 exact schema；测试覆盖未知 channel、错误参数、越权形状 |
| L3-01 | Codex/创作体验 | todo | 为 AI 覆写增加 diff 预览 | `packages/ai/src/nodes/save-result.node.ts`、renderer AI 预览组件、内容版本表 | 章节/剧本/镜头 Prompt 覆写前可查看差异；用户确认后写入；取消不会修改正文 |
| L3-02 | Codex/创作体验 | todo | 增加版本比较与一键恢复 | `content_versions` repository、Workspace/Script/Shot 页面 | 用户可查看历史版本、比较当前版本、恢复指定版本；恢复操作也生成新版本记录；相关 smoke/单测通过 |
| L3-03 | Codex/创作体验 | todo | 明确自动落库任务策略 | AI workflow、prompt registry、UI 文案 | 每类任务标记“预览后采用”或“自动写入”；危险覆写默认走确认；文档与 UI 行为一致 |
| L4-01 | Codex/安全 | todo | 加固 API Key 存储降级策略 | `apps/desktop/electron/secrets.ts`、模型/视频设置页 | `safeStorage` 不可用时显示明确警告；可选择拒绝保存或显式降级；不会静默明文落库 |
| L4-02 | Codex/安全 | todo | 增加密钥迁移和健康检查 | secrets、设置页、诊断文档 | 能识别明文/加密/掩码状态；启动时迁移可审计；失败不丢 key 且提示可操作 |
| L5-01 | Codex/视频平台 | todo | 拆分真实视频 Provider 适配器框架 | `packages/ai/src/providers/video`、`AI_VIDEO_GUIDE.md` | `mock/custom` 与真实平台适配器分离；每个平台有独立鉴权、请求、状态映射、错误归一化接口 |
| L5-02 | Codex/视频平台 | todo | 落地首个真实视频平台适配 | video provider、视频设置页、视频任务页 | 至少一个真实平台完成提交、轮询、失败处理、结果保存；可用 mock 测试和真实配置手工 smoke 验证 |
| L5-03 | Codex/视频平台 | todo | 视频结果本地归档 | 视频任务服务、DB、文件存储策略 | 可将远端视频/封面保存到本地项目资产目录；记录本地路径与远端 URL；导出项目包策略明确 |
| L6-01 | Codex/任务系统 | todo | 引入长任务队列模型 | AI IPC、video service、DB schema/migration | AI/视频长任务有 `pending/running/success/failed/canceled` 状态；任务可恢复查询；迁移与 DB smoke 通过 |
| L6-02 | Codex/任务系统 | todo | 支持取消、重试、并发限制 | AI workflow、HTTP provider、UI | 用户可取消运行中任务；失败任务可重试；同类任务并发可配置或有限制；取消不会产生半写入 |
| L6-03 | Codex/任务系统 | todo | 批量生成进度持久化 | 剧本批量生成、分镜批量生成、工作流记录 | 批量任务中断后可看到已完成/失败项；重跑只补未完成项；UI 显示进度与错误明细 |
| L7-01 | Codex/AI 基础设施 | todo | 上下文 token 预算与裁剪 | `packages/ai/src/context/context-builder.ts`、`load-project-context.node.ts` | 不再无上限拼接长文本；按任务定义上下文预算；超限时使用摘要/最近记录/关键实体；新增测试覆盖大项目 |
| L7-02 | Codex/AI 基础设施 | todo | 增加上下文预览与调试导出 | AI run、设置/诊断页 | 用户可查看本次发送给模型的上下文摘要；敏感样本文档仍不写入日志；诊断导出可复现问题 |
| L7-03 | Codex/AI 基础设施 | todo | Token/费用预算控制 | 模型配置、AI run summary、UI | 可设置单次/每日 token 或费用提醒；超预算前提示；统计页按模型/任务组展示消耗 |
| L8-01 | Codex/发布工程 | todo | 建立 CI 基线 | `.github/workflows`、package scripts、文档 | CI 至少运行 install、typecheck、unit、DB smoke；原生模块缓存策略明确；PR 失败可定位 |
| L8-02 | Codex/发布工程 | todo | 建立跨平台打包 smoke | electron-builder、CI、release 文档 | macOS/Windows/Linux 安装包可构建；至少验证应用启动和数据库初始化；产物不包含源码外敏感文件 |
| L8-03 | Codex/发布工程 | todo | 完成签名、公证与自动更新设计 | `electron-builder.yml`、发布文档 | mac hardened runtime 配置完整；notarization/签名变量文档化；自动更新源与回滚策略明确 |
| L9-01 | Codex/可观测性 | todo | 增加本地日志系统 | Electron main、renderer、AI/video services | 主进程、渲染进程、AI、视频任务写入滚动日志；日志不包含 API Key 或上传原文 |
| L9-02 | Codex/可观测性 | todo | 增加诊断包导出 | 设置页/帮助页、日志、环境信息 | 用户可导出诊断包；包含版本、系统、迁移版本、最近错误和脱敏日志；不包含正文/密钥，除非用户显式选择 |
| L9-03 | Codex/稳定性 | todo | 增加渲染层 Error Boundary 与崩溃恢复 | `apps/desktop/renderer/src`、main 进程事件 | 页面异常不白屏；提供返回首页/重载/导出诊断；未处理 promise rejection 有日志 |
| L10-01 | Codex/测试 | todo | 增加前端 E2E smoke | Playwright 或 Electron 测试工具、核心页面 | 覆盖创建项目、创建章节、模型配置表单、项目包导入导出最小路径；CI 可运行或有本地命令 |
| L10-02 | Codex/测试 | todo | 增加 AI workflow mock 回归 | `packages/ai`、tests | 使用 mock provider 覆盖成功、JSON 修复重试、模型失败、空输出、写入内容版本；`pnpm test:unit` 通过 |
| L10-03 | Codex/测试 | todo | 增加迁移回放测试 | `packages/db/src/migrator.ts`、fixtures、smoke | 从旧版 fixture 升级到最新 schema；重复迁移幂等；失败迁移回滚可测 |
| L11-01 | Codex/安全 | todo | 收紧 Electron 外链与 CSP | `apps/desktop/electron/main.ts` | 默认只允许 HTTPS；localhost/dev 仅开发态；CSP 与图片/媒体来源策略有测试或手工验证记录 |
| L11-02 | Codex/安全 | todo | 增加文件导入安全限制 | 项目包导入、样本文档导入、视频素材导入 | 文件大小、扩展名、解析失败、超大文本截断策略统一；错误提示可操作；不会阻塞主进程 |
| L12-01 | Codex/产品体验 | todo | 增加质量闸门仪表盘 | Workspace/Adaptation/Script/Shot 页面 | 用户能看到未记忆章节、未审稿剧本、高风险镜头、失败任务；点击可跳转处理 |
| L12-02 | Codex/产品体验 | todo | 增加全局搜索 | DB repository、renderer 页面 | 可搜索项目、人物、章节、剧本、场景、镜头 Prompt、AI 记录；大项目响应可接受 |
| L12-03 | Codex/产品体验 | todo | 完善完整工作流模板 | creative workflow、template、UI | 从小说到分集、剧本、分镜、视频任务有可复用流水线；每步可暂停、查看结果、重试 |
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

- 当前已知测试基线：`pnpm test` 可通过，包含 typecheck、13 个单元测试、DB smoke，并会在结束时重编 `better-sqlite3` 回 Electron ABI。
- 现有明显缺口：无 CI、无 E2E、无打包 smoke、无签名/公证/自动更新闭环、IPC 业务 schema 不完整、备份恢复入口缺失、长任务队列缺失、真实视频平台适配仍需专用实现。
- 当前文档状态：本文件仅是 loop 规划，所有 loop 初始状态均为 `todo`；实际执行后按 LOOPRULE 更新状态。

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
