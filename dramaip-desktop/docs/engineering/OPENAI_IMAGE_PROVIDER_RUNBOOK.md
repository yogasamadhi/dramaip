# OpenAI Image Provider Runbook（LM5-10 scaffold）

当前实现的是官方 OpenAI Images API 的受控适配器，默认不在 Desktop 设置页暴露、不读取环境变量、也不会创建网络请求。它需要后续的 Keychain 设置和图片任务持久化才能进入生产；本轮没有凭据，因此没有执行真实沙箱生成。

## 已验证的本地合同

- 使用 `POST https://api.openai.com/v1/images/generations`、`gpt-image-2`、`b64_json` 输出归档语义。
- 只有同时存在 API Key 和 `featureEnabled: true` 时适配器才允许提交。
- 文本生图路径拒绝 `file:` 参考图；参考图编辑必须使用独立、审查过的 edits 上传流程，不能偷偷上传本地素材。
- API 返回的图片以 base64 交给未来的项目资产归档器，不能写入日志、项目包或截图 fixture。

## 进入生产前的必需工作

1. 在系统 Keychain 保存用户主动录入的 API Key；不得写入 SQLite、默认参数、日志或环境文件。
2. 由图片任务表、IPC 和资产归档器接管提交、费用/usage、失败重试和本地文件写入。
3. 用用户自有、已授权的测试素材在隔离项目执行一次生成与归档 smoke；记录日期、模型、区域、实际费用和数据保留声明。
4. 只在该 smoke 成功后开放设置页的生产开关；无 Key、开关关闭、权限/余额失败都必须显示不可提交。

官方依据：GPT Image 2 是官方图像生成/编辑模型，支持 `/v1/images/generations` 和 `/v1/images/edits`；图片端点的数据保留与图片输入审查规则应在上线前再次以当前官方文档复核。
