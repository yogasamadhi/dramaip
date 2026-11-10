# 锁定的第三方引擎

本目录维护桌面端使用的第三方引擎源码。上游子模块保持只读，各自遵循上游许可证；版本和完整性由相邻锁文件记录。

- `deepseek-harness/`：提供 Cordis 框架源码与基础设施参考，锁定信息见 `deepseek-harness.lock.json`。
- `pi/`：Pi 智能引擎源码，锁定信息见 `pi.lock.json`。
- `pi-model-data.tgz`：固定的 Pi 模型目录构建输入，摘要记录在 `pi.lock.json`。

从桌面工作区运行 `pnpm run prepare:submodules` 初始化；运行 `pnpm run check:engine-locks` 验证。子模块路径由工作区的 `.gitmodules` 配置。

框架复制品生成到 `build/dsh-framework/`，桌面 Runtime 生成到应用构建目录。上游许可与应用复制记录见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
