# 开发指南

## 环境

安装 Git、Node.js **24.18.0** 和 pnpm **11.28.5**。本工作区使用 pnpm 管理依赖；桌面应用的 Host 使用 Electron 内嵌的 Node.js。

以下命令均从含 `package.json` 的桌面工作区根目录执行。

## 启动

```bash
pnpm run dev
```

启动器会准备第三方子模块、Cordis 框架、工作区依赖、Pi Runtime 和 Electron 二进制。首次运行需要网络访问。

只准备开发环境或检查现有环境：

```bash
pnpm run dev:prepare
pnpm run dev:check
```

需要逐步准备时：

```bash
pnpm run prepare:submodules
pnpm run prepare:framework
pnpm install --frozen-lockfile
pnpm run build:framework
pnpm run check:framework
```

## 源码布局

| 目录                                         | 职责                                       |
| -------------------------------------------- | ------------------------------------------ |
| `apps/desktop`                               | Electron 主进程、preload 与打包配置        |
| `apps/desktop-host`                          | 桌面 Host 入口                             |
| `apps/cli`、`apps/web`                       | CLI 与 Web 入口                            |
| `packages/infra`                             | 存储、通信、配置、UI 等基础设施            |
| `packages/boot`                              | 插件组合与启动配置                         |
| `packages/host`、`packages/seams`            | 本机能力与引擎接口                         |
| `packages/workspace`、`writing`、`agents` 等 | 各业务域的 Host 和 Client 插件             |
| `architecture`                               | 构建和检查工具使用的清单，不是项目规划文档 |
| `tests`                                      | 自动化测试与公开交换格式夹具               |
| `vendor`                                     | 版本锁定的第三方源码                       |

第三方源码按锁文件维护；框架构建输出生成到 `build/dsh-framework/`。依赖与许可说明见 [vendor 说明](../vendor/README.md) 和 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 常用验证命令

| 命令                          | 用途                           |
| ----------------------------- | ------------------------------ |
| `pnpm run lint`               | 静态检查                       |
| `pnpm run format:check`       | 格式检查                       |
| `pnpm run typecheck`          | 类型检查                       |
| `pnpm run test`               | 类型检查与单元测试链           |
| `pnpm run test:e2e`           | 构建并运行 Electron 端到端测试 |
| `pnpm run check:architecture` | 插件与依赖边界检查             |
| `pnpm run check:engine-locks` | 引擎版本和源码完整性检查       |
| `pnpm run check:licenses`     | 许可证元数据检查               |

构建和安装包说明见 [打包指南](PACKAGING.md)。

## 隔离调试

可设置 `DRAMAIP_HOME` 为独立目录，避免调试数据与日常项目混用。需要后台调试时，可设置 `DRAMAIP_DEBUG_BACKGROUND=1` 后运行开发启动命令。

`plugin2dsh/` 是独立工程，不属于主 pnpm 工作区；其依赖安装与验证命令见 [插件 README](../plugin2dsh/README.md)。
