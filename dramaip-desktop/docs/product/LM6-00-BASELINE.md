# LM6-00 可信基线与结果契约

- Baseline source: `origin/main` at `2e713443` before this Loop's changes.
- Fixture schema: `v3`; all fixture data is synthetic and stays under `tests/fixtures/lm6/lm6-00/`.
- Automated entry: `bun test tests/lm6/lm6-00.test.ts` plus the local HTTP production-structure contract in `bun run test:node`.

## 当前事实（2026-08-12）

| 能力                                | 状态        | 可复查证据                                                                   | 边界                                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 本地项目创建与首次结果              | implemented | `POST /api/v1/projects` 持久化项目并产生 `project.created` SSE               | 这是本地 HTTP contract，不等同于云同步成功。                        |
| 原著 Markdown 导入                  | implemented | preview → 明确 rights confirmation → commit；本基线 fixture 导入“前言”和两章 | 默认 append 不创建内容 checkpoint；merge / replace 才用于覆盖恢复。 |
| 剧本 / 场景 / 分镜结构              | implemented | `production-structure HTTP contract` 覆盖 episode → script → scene → shot    | 不是 P0 所需的“唯一下一步”驾驶舱。                                  |
| 视觉资产采用与锁定                  | implemented | `POST /api/v1/visual-assets` 和 `/lock` 的服务端 contract                    | 是结构化资产状态，不等同于真实媒体生成。                            |
| 项目包导入 / 导出                   | implemented | 导出 JSON → capability preview → commit 的无路径泄漏往返                     | 往返验证的是结构化实体，不是旧项目的原地升级。                      |
| 九个全局导航入口                    | implemented | `packages/app/src/main.tsx`                                                  | 仍是多页通用工作区；P0 驾驶舱另由 LM6-02 完成。                     |
| 单一建议下一步                      | partial     | 当前没有从项目状态派生、可机测的 cockpit action                              | 不从“路由存在”或助手卡片推断完成。                                  |
| 简化的上下文助手                    | partial     | 当前侧栏仍公开引擎、模型、任务和盲测参数                                     | LM6-03 负责默认隐藏实现细节。                                       |
| 成本 Gate                           | partial     | 服务端预检、快照与 ledger 有 contract                                        | 新用户默认体验尚未形成完整成本决策流。                              |
| 真实 Provider / 云对象存储 / 云审片 | unknown     | 本基线只运行 fake provider 和本地 HTTP contract                              | 外部凭据、网络和对象存储不可用时不得把 mock 标成真实成功。          |
| 真实 NLE 导入与远程 MP4             | unknown     | 本基线没有安装或调用外部 NLE / 渲染服务                                      | 文件或 reference parser 通过不等同于真实软件兼容。                  |

## 结果契约

| P0 / P1 / P2 结果 | 当前可观察信号                                     | 真实状态                                    |
| ----------------- | -------------------------------------------------- | ------------------------------------------- |
| 首次可信结果      | 项目已持久化，并收到 `project.created` SSE         | implemented                                 |
| 单一下一步        | 从项目数据派生的唯一 action                        | partial                                     |
| 人工采用          | preview 后显式 `commit` 或 `adopt` 才写入权威实体  | implemented                                 |
| 成本 Gate         | 服务端 preflight / ledger 记录能力、成本和提交边界 | partial                                     |
| 真实交付          | 本地结构化 export / reference timeline artifact    | partial；真实 NLE、MP4 为 external evidence |

产品状态仅使用 `implemented`、`partial`、`unavailable`、`unknown`；验证状态仅使用 `pass`、`fail`、`timeout`、`not-run`。Provider 证据还必须标注为 `fake`、`local` 或 `external`，不能混用。

## 基线验证摘要

在安装 lockfile 依赖后，本 Loop 运行了以下命令：

| 命令                             | 结果 | 摘要                                                                    |
| -------------------------------- | ---- | ----------------------------------------------------------------------- |
| `bun run typecheck`              | pass | 12 个 Turbo 任务通过。                                                  |
| `bun run lint`                   | pass | `oxlint --deny-warnings` 通过。                                         |
| `bun run test:unit`              | pass | 包级 unit、SQLite conformance、服务端 contract 与 LM6-00 fixture 通过。 |
| `bun run check:generated`        | pass | Client 与 ai-legacy 生成物一致。                                        |
| `bun run check:engine-locks`     | pass | 锁定 OpenCode `1.18.15`、Codex `0.147`。                                |
| `bun run check:provider-catalog` | pass | Provider catalog 为 RC `2.0.0`，最近核对日 `2026-08-11`。               |
| `bun run build`                  | pass | Desktop bundle 成功。                                                   |
| `bun run test:e2e`               | pass | 3 个 Electron smoke 场景通过。                                          |

首次运行 `bun run typecheck` 时环境尚未安装依赖，显示 `turbo: command not found`；执行 `bun install --frozen-lockfile` 后重跑通过。这是环境前置条件，非产品回归。
