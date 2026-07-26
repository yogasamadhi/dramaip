# Release Candidate — LM5-21（草稿）

此文件是发布证据的模板与当前真值，不是“已发布”声明。每次候选必须替换日期、commit、产物 hash 与执行结果。

## 当前基线

- Desktop 主线：以本次 release gate 合并后的 `main` 为准。
- 本地自动化：格式、TypeScript、单元、SQLite 迁移回放、Electron E2E/UI、打包目录 smoke 均为必跑项。
- 三条创建路径与生产链：由 Electron E2E fixture 覆盖创建项目、导入小说/剧本、改编、分镜、渲染、质检、合规、项目包往返及恢复语义。

## 不可放行条件

以下任一项缺失即不得把候选标为可发布：

1. OpenAI Image 尚无 Keychain 设置、图片任务归档和授权 sandbox 证据。
2. OpenAI TTS 尚无 Keychain/成本/归档接线和授权 sandbox 证据；人工音轨仍是可用回退。
3. Hailuo 或 Wan 真实视频 sandbox 需 `*_SANDBOX_ALLOW_BILLING=1` 与由秘密注入环境提供的专用 API Key；不能使用源码、Gitee 账号或普通用户密码替代。
4. macOS/Windows/Linux 正式签名、公证/安装/升级/回滚证据需由拥有证书与目标系统的 release 环境提供。

## 记录格式

```text
Candidate commit:
Build host / architecture:
Artifacts + SHA-256:
Install / upgrade / rollback result:
Automatic gates:
Provider sandbox evidence (redacted):
Known limitations:
Approval:
```
