# DramaIP v2.0.0 Release Candidate

此文件记录当前发布真值，不是“已发布”声明。源码版本保持 `2.0.0-rc.1`，直到全部外部证据通过后才允许改为 `2.0.0`。

## 已完成的代码门禁

- Desktop v0→v44 SQLite 迁移、迁移前备份、项目包 v1/v12→v13 往返。
- 内置 10 镜头离线样片、导演工作台、生产影响、不可变 Retake、路由、离线审片与编辑器清单。
- OpenAI Image Generation/Edit、OpenAI TTS、Hailuo 与 Wan 独立适配器及无凭据契约测试。
- Studio 云审片的私有对象存储、token hash、PIN、配额、保留期、上传校验、评论游标与撤销。
- Free/Creator/Studio/Enterprise 权益快照、团队席位和旧订阅续期迁移。
- 官网、定价、信任、下载、团队、案例与匿名审片页面。

## 当前 GA 阻断项

`pnpm release:gate` 是唯一 GA 判定入口。它要求正式 HTTPS 更新源、生产支付和对象存储配置、macOS/Windows 签名凭据，并逐项验证以下与当前 commit 绑定、已脱敏的受管证据：

- OpenAI Image Edit、OpenAI TTS、Hailuo、Wan 真实 sandbox；
- FCPXML 1.10 在 Final Cut Pro 12.2 导入、EDL relink；
- macOS 签名/公证/安装/升级，Windows 签名/安装/升级，Linux Beta smoke；
- 云审片配额、越权、token 穷举、恶意媒体、到期清理、备份恢复；
- 支付生产演练与平台备份恢复。

证据 JSON 使用 `docs/release/evidence-template.json`，原始证据留在受管系统，不提交 Prompt、媒体、路径、URL、token、账号或密钥。任何缺项都会返回非零状态并输出 `RESULT: RC ONLY`。

## RC 结论

当前仓库没有上述外部凭据和实机证据，因此 v2.0.0 必须保持 RC。不得降低门禁、把 Mock 结果冒充真实 Provider、把 XML 语法测试冒充 Final Cut Pro 导入，或发布未签名安装包。
