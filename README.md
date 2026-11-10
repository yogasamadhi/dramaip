# 尽意 DramaIP

> 尽作者之意，成万象之作

尽意 DramaIP 是面向小说创作、AI 编剧与 IP 改编的本地优先桌面工作台。作者可以维护故事母本、章节、人物与世界设定，将创意或已有作品推进为剧本、分镜和交付资料，并通过版本与来源记录管理修改。

小说创作可独立使用，不必进入改编或媒体制作流程。AI 通过配置的模型服务辅助创作，由作者审阅和决定采用；本地优先指项目数据的管理方式，不代表模型可以离线推理。

当前版本为 **3.0.0-alpha.3**，仍处于开发阶段。

## 快速开始

开发环境要求 Git、**Node.js 24.18.0** 和 **pnpm 11.28.5**。在本目录运行：

```bash
pnpm run dev
```

启动器会初始化第三方子模块、准备框架、安装依赖并构建所需 Runtime，然后启动桌面开发环境。首次运行需要网络访问并可能耗时较长。

已配置环境的只读检查：

```bash
pnpm run dev:check
```

## 文档

- [使用说明](docs/GETTING_STARTED.md)：创作流程、模型配置与本地数据。
- [开发指南](docs/DEVELOPMENT.md)：环境准备、源码布局和验证命令。
- [打包指南](docs/PACKAGING.md)：构建、安装包与更新地址配置。
- [DSH 插件](plugin2dsh/README.md)：在 DeepSeek Harness 内使用独立的写作插件。

## 源码布局

```text
apps/          Electron 桌面壳、Host、CLI 与本地 Web 入口
packages/      业务插件、共享契约与基础设施
scripts/       开发、构建和检查工具
tests/         自动化测试与测试夹具
profiles/      运行配置
bundles/       插件组合配置
architecture/  架构检查使用的机器可读清单
vendor/        锁定的第三方引擎源码与版本记录
plugin2dsh/    独立管理依赖和构建的 DSH 插件
docs/          使用、开发和打包文档
```

## 许可证

自有源码采用 [Apache License 2.0](LICENSE)，版权声明见 [NOTICE](NOTICE)。第三方代码保留各自许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
