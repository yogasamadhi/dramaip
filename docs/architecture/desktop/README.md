# Desktop 架构文档

本目录集中维护通用 Desktop 分级架构、DramaIP Desktop 目标规范和实施路线。

产品市场定位、用户与业务边界由[产品定位](../../product/POSITIONING.md)统一定义；本目录只定义支撑这些目标的技术架构，不将路线能力写成当前已实现功能。

本次同步日期：2026-09-10。规范描述设计约束；当前状态按工作区代码核对，已执行的迁移验收记录日期为 2026-09-07，不代表本次重新执行了全量测试或正式发布。

## 阅读顺序

1. [通用桌面架构基线](./DESKTOP_ARCHITECTURE_BASELINE.md)
2. 按产品复杂度选择 [Level 1](./DESKTOP_ARCHITECTURE_LEVEL1_SMALL_FINAL.md)、[Level 2](./DESKTOP_ARCHITECTURE_LEVEL2_LARGE_CLOSED_FINAL.md) 或 [Level 3](./DESKTOP_ARCHITECTURE_LEVEL3_LARGE_OPEN_FINAL.md)
3. DramaIP 实现以 [DramaIP Client / Plugin Runtime 目标架构](./DRAMAIP_CLIENT_PLUGIN_RUNTIME_ARCHITECTURE.md) 为最高优先级规范
4. 通过 [Desktop Architecture Roadmap](./DESKTOP_ARCHITECTURE_ROADMAP.md) 跟踪当前差距和实施顺序

当前代码已经实现的事实仍记录在 [desktop/docs/engineering/ARCHITECTURE.md](../../../desktop/docs/engineering/ARCHITECTURE.md)，避免把目标、计划和现状混写在同一份文档中。

## DramaIP 当前架构选择

| 范围          | 当前选择                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 第一方插件    | 14 个插件使用锁定 DSH Cordis 的 `Context / Service / inject / effect / Fiber`；Kernel 校验产品契约和贡献 |
| 源码与构建    | DSH vendor 只读；九个框架包生成到 `desktop/build/dsh-framework/`，由 Bun 1.4.0 安装、构建和校验          |
| Core 执行环境 | 独立运行、迁移 Worker、Runtime 测试使用 Node 24.18.0；桌面 Core 使用 Electron 内嵌 Node                  |
| 装配          | 空根配置 → 六个 Bundle patch → Profile patch；五个 Profile JSON 只选择 Bundle                            |
| 开发重载      | DSH Loader/Include/Group、Timer/HMR；请求暂停与排空、贡献暂存、图校验后原子发布，失败恢复上一成功构建    |
| 生产运行      | 不监听第一方文件变化；Runtime 产物包含模块、配置和依赖，可在仓库外启动                                   |
| 第三方扩展    | 独立 Extension Graph、每 revision 独立进程与 QuickJS/WASM；公开 SDK 不暴露 Cordis                        |

Level 1 仍是无需插件框架的通用选择；Level 2 定义第一方组合与生命周期，Level 3 在此基础上增加扩展隔离。DramaIP 的源码来源、工具链和第一方 HMR 选择以产品规范为准。

## 实施与验证入口

- [DSH Cordis 迁移说明与验收记录](../../../desktop/docs/engineering/DSH_CORDIS_MIGRATION.md)：九包来源、安装顺序、原生生命周期、HMR 恢复和测试证据。
- [Desktop 启动与构建说明](../../../desktop/README.md)：开发、独立 Runtime 和打包命令。
- [Desktop 脚本清单](../../../desktop/package.json)：测试、生成和检查命令的权威入口。
- [DSH 锁定快照](../../../desktop/vendor/deepseek-harness.lock.json)：来源版本、源码哈希与完整性约束。

当前仍未完成正式跨平台 GA 验收：Windows/Linux 候选包验证、Apple 正式分发签名与公证等不能由本机 macOS 目录包测试替代。Isolated Interactive UI、远程发布者后台和多 Runtime 共享 SQLite 的 consumer lease 继续留在后续范围；本目录不为 Platform 增加构建或运行依赖。
