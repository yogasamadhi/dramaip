# DramaIP v2.0.0 Release Candidate

产品发布口径必须与 [产品定位](../../../docs/product/POSITIONING.md) 一致：当前产品是面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台；不得在发布材料中改写为“一键爆款”“全自动成片”或单纯的视频生成器。

此文件记录当前发布真值，不是“已发布”声明。源码版本保持 `2.0.0-rc.1`，直到全部外部证据通过后才允许改为 `2.0.0`。

## 已完成的代码门禁

- Desktop 前向 SQLite 迁移、迁移前备份，以及项目包 schema v1–v4 预览/导入和 v4 往返。
- 内置 10 镜头离线样片、导演工作台、生产影响、不可变 Retake、路由、离线审片与编辑器清单。
- OpenAI Image Generation/Edit、OpenAI TTS、Hailuo 与 Wan 独立适配器及无凭据契约测试。
- Studio 云审片的私有对象存储、token hash、PIN、配额、保留期、上传校验、评论游标与撤销。
- Free/Creator/Studio/Enterprise 权益快照、团队席位和旧订阅续期迁移。
- 官网、定价、信任、下载、团队、案例与匿名审片页面。

## P2 机器验收边界

`LM6-25` 使用 `full-electron-journey`、`timeline-reference-parser`、`local-project-package-and-migration`、`series-link-and-fork` 和 `two-identity-cloud-review-fake-gateway` 作为可复跑证据：本地样片可进入多轨时间线与离线审片，FCPXML / OTIO / EDL 由固定 reference parser 校验，系列 Link / Fork、项目包与两身份审片反馈由本地契约验证。

这些结果不构成外部发布声明：`no-real-nle-import-claim`、`no-mp4-without-timeline-render-provider`、`cloud-review-is-optional-and-local-first` 与 `docker-compose-e2e-is-enhanced-evidence` 均适用。没有受管环境的真实导入、真实渲染、生产对象存储与签名安装包证据时，版本仍只能是 RC。

## 当前 GA 阻断项

GA 判定必须运行 Bun 1.4.0 完整质量门、Electron E2E、`package` 和 `release:metadata`，并在受管发布环境中补齐正式 HTTPS 更新源、生产支付和对象存储配置、macOS/Windows 签名凭据及以下与当前 commit 绑定、已脱敏的证据：

- OpenAI Image Edit、OpenAI TTS、Hailuo、Wan 真实 sandbox；
- FCPXML 1.10 在 Final Cut Pro 12.2 导入、EDL relink；
- macOS 签名/公证/安装/升级，Windows 签名/安装/升级，Linux Beta smoke；
- 云审片配额、越权、token 穷举、恶意媒体、到期清理、备份恢复；
- 支付生产演练与平台备份恢复。

证据 JSON 使用 `docs/release/evidence-template.json`，原始证据留在受管系统，不提交 Prompt、媒体、路径、URL、token、账号或密钥。任何缺项都必须阻断正式发布并保持 RC 状态。

## RC 结论

当前仓库没有上述外部凭据和实机证据，因此 v2.0.0 必须保持 RC。不得降低门禁、把 Mock 结果冒充真实 Provider、把 XML 语法测试冒充 Final Cut Pro 导入，或发布未签名安装包。
