# DSH Cordis 源码与 Desktop 插件迁移

Desktop 第一方插件使用当前锁定的 DSH `0.2.1-rc.3` 框架源码。Platform、第三方 Extension Host、公开 Plugin API 和 Agent Runtime 的隔离边界保持独立。

框架迁移服务 [产品定位](../../../docs/product/POSITIONING.md) 下的独立小说与改编两路创作、连续性和版本资产，不将通用 Agent/扩展平台作为产品市场定位。本文的工程验收不证明真实模型文学质量、新主流程完成或正式跨平台发布。

## 源码与安装

来源为 `../vendor/deepseek-harness/vendor` 的九个包：Cordis、Cosmokit、Schemastery、Loader、Include、Group、Timer、HMR、Logger Console。锁文件记录的完整源码树 SHA-256 是 `e80084a15076066a5ec88b217f3907b5bbbb0580ef10d10aaf329846faf3208c`，包含 16,347 个文件。每个包保留 DSH 名称、版本和 MIT 许可证。

```bash
git submodule update --init
cd desktop
pnpm run prepare:framework
pnpm ci
pnpm run build:framework
pnpm run check:framework
```

准备脚本先校验 pnpm 11.28.5 和锁定源码，复制源码及元数据到忽略提交的 `build/dsh-framework/`，生成本地 workspace 清单。TypeScript 生成声明，esbuild 生成 DSH 包导出所需的 ESM/CJS 入口。检查脚本验证源码、许可证、构建哈希，以及所有引用者的真实解析路径，拒绝 registry 副本。vendor 不参与构建写入，也不维护另一份手写源码。

独立 Runtime 和迁移 Worker 使用 Node 24.18.0；桌面端使用 Electron 内嵌 Node。`scripts/run-node.mjs` 校验独立 Node 版本，支持 `DRAMAIP_NODE_PATH`。pnpm 只承担依赖管理、构建和不依赖 Core 的测试。`runtimeKind` 只报告 `node` 或 `electron-node`；`bun` 已从契约移除。

## 插件与装配

14 个第一方模块导出原生 Cordis 插件，使用 `apply`、`inject`、`ctx.plugin()` 和 `ctx.effect(acquire, label)`。基础环境由 `Service` 提供，业务服务通过带 owner/major/capability 校验的 `provideService` 注册到同一个 Cordis Context。`requireService`/`optionalService` 只读取 Cordis，不持有第二套服务实例。

`scripts/first-party-sources.ts` 是工具期注册源；`plugins:generate` 从插件声明生成身份、迁移及 contribution 清单。Runtime 只静态导入生成元数据，Loader 动态导入插件实现。公开 API 和 Renderer 不导入 Cordis。持久事件入口是 `ctx.domainEvents`，业务写入和事件继续由同一个 UnitOfWork 事务提交。

Profile JSON 只选择 Bundle。六个 Bundle 与五个 Profile 的 `cordis.patch.yml` 叠加在空 `cordis.yml` 上，使用 DSH Include 的 schema 和 `applyEntryPatches`。该原生函数会修改插入的条目，因此预检与正式 Loader 分别解析输入，不增加自定义合并算法。

启动顺序为配置/依赖预检、迁移、Loader/Include/Group 装配、等待所有启用条目与子 Fiber、校验服务和贡献、发布 Core Graph。pending 与异步激活失败都不能成为成功启动。effect 诊断来自真实 Fiber 元数据，`acquiredAt` 记录首次观察该原生 effect 的时间；清理遵循 DSH 并发语义，有顺序要求的资源放入同一个 effect 并逐步 await。

## 开发与恢复

```bash
# 仓库根目录：桌面开发启动器
python3 run-desktop.py
# desktop/：独立 Node 开发 Runtime
pnpm run dev:runtime --profile server --database /absolute/path/dramaip.db
```

开发启动器构建并监听 ESM 模块。DSH Loader 使用 `--expose-internals`，启动时无法取得内部 Loader 则报错。框架、公共元数据、启动入口和迁移变化走完整重启；业务插件变更由 DSH HMR 局部重载，并按原生注入关系重建依赖。

DSH 没有异步 before-reload hook，因此 Kernel 在锁定版本的 HMR 实例上协调 `partialReload`：先阻止新业务请求并等待现有 handler 退出，再交给原生 HMR。此适配不修改 vendor 的实现。路由/UI 暂存，全部生命周期与图校验成功后同步发布 Router、Core Graph 和诊断；期间返回 RFC 7807 `RUNTIME_RELOADING`。

导入和配置错误使用 DSH 自身恢复机制。异步激活失败或恢复后不完整时，恢复 `build/runtime/.last-good.json` 中上一成功代码/配置，supervisor 启动新 Runtime。恢复不覆盖业务数据库或开发者源码。运行任务继续使用原有中断/恢复协议，不自动重放业务写入。第三方更新仍使用独立 Extension Graph。

## 构建与验收

`pnpm run build` 生成 `build/runtime/`，包含保留模块边界的 ESM、配置、九个框架包与依赖闭包。发布依赖集中放置，仅版本冲突保留局部链接，避免签名工具遍历 peer 依赖环。所有链接均为目录内部的相对链接，可复制到仓库外启动；Windows 构建机需要启用开发者模式或具备创建目录符号链接的权限。TypeScript 类型导入必须被擦除，不能在 ESM 中留下 `AgentRouteDraft` 等不存在的值导出。Electron 发布包携带整个 Runtime 目录和许可证，排除恢复日志，关闭文件监听。

```bash
pnpm run check:framework
pnpm run test:runtime:node
pnpm run test:conformance
pnpm run test:runtime:watch
pnpm run test:runtime:hmr
pnpm run test:runtime:hmr:electron
pnpm run architecture:generate
pnpm run check:architecture
pnpm --filter @dramaip/client run generate
pnpm run check:generated
pnpm run migration:generate
pnpm run check:migration:complete
pnpm run build
pnpm run check:renderer-chunks
```

HMR 集成测试将发布目录复制到临时目录，逐一启动五个 Profile，再检查模块与配置重载、依赖插件重建、重复事件、资源数量、导入/配置失败以及异步失败后的新进程恢复。Node 与真实 Electron utility process 执行同一组测试。业务测试覆盖 SQLite、迁移硬超时恢复、SSE、幂等写入、ETag 和运行任务恢复；桌面 E2E 与打包门禁补充验证完整应用链路。

这次迁移不构成 macOS/Windows/Linux 签名、升级或正式 GA 的发布声明。

## 本机验收记录（2026-09-07，macOS arm64）

| 检查                                                          | 结果                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 临时工作区从无依赖、无构建产物开始                            | prepare → 冻结安装 → 九包构建/哈希/许可证/解析路径检查 → Runtime 构建与仓库外启动通过；vendor 无修改                 |
| Node Runtime 与生命周期                                       | 18 个文件、95 项测试通过，另有迁移 Worker 硬超时及完整性恢复验证                                                     |
| Public Plugin API、Engine、Extension Host、安全与 Marketplace | 27 项 conformance 测试通过                                                                                           |
| Node 与真实 Electron utility process                          | 五个 Profile 装载、迁移超时恢复、模块/配置 HMR、依赖重建、重复事件、资源数量、失败快照恢复和共享契约完整重启检查通过 |
| 源码监听                                                      | 新增/修改/删除模块、类型导入擦除及未变化元数据/共享模块的 mtime 检查通过                                             |
| Electron E2E                                                  | 完整 51 项通过；增加的开发/生产 HMR 开关断言分别复验通过                                                             |
| 静态与生成门禁                                                | 33 个工作区类型检查、lint、格式、架构、Client/OpenAPI、引擎锁、许可证与 Renderer chunk 检查通过                      |
| 迁移证据                                                      | 210 implemented、0 remaining、2 replaced、5 retired；577 个有效 operation；注册表 14 个插件、目录 33 个服务          |
| 本地发布目录                                                  | macOS arm64 `.app` 构建及 ad-hoc 签名通过；复制到仓库外启动通过，确认 HMR 关闭、依赖链接在包内、九个许可证齐全       |

Windows/Linux 的对应 CI 链路已配置，本机未执行这些系统的构建。Apple 公证和正式分发签名未执行。
