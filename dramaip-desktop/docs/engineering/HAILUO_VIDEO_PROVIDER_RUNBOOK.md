# MiniMax Hailuo 视频 Provider 运行手册

本手册覆盖 Desktop 的首个国内真实视频渠道：MiniMax Hailuo。它只描述已实现的
`hailuo` adapter；即梦、可灵、Runway 和 Pika 仍处于独立的未启用适配槽位。

## 选择与边界

选择 Hailuo 的原因是官方开放平台提供了稳定的异步三段式接口：创建视频任务、按
`task_id` 轮询、以成功响应中的 `file_id` 换取下载 URL。当前实现使用
`MiniMax-Hailuo-2.3`，支持文生视频及使用首帧 URL 的图生视频；首尾帧参数可通过
默认参数 JSON 的 `last_frame_image` 传入。

- 官方调用指南：[视频生成](https://platform.minimaxi.com/docs/guides/video-generation)
- 官方接口：[创建图生视频任务](https://platform.minimaxi.com/docs/api-reference/video-generation-i2v)、[文件检索](https://platform.minimaxi.com/docs/api-reference/file-management-retrieve)
- 未实现：平台端取消。界面的“停止跟踪”只中止本地轮询，绝不声称已取消远端计费任务。
- 未实现：回调接收。本地桌面应用没有公开回调地址，采用官方建议的轮询方式；轮询间隔不得低于 10 秒。

## 安全配置与上线开关

1. 在「设置 → 视频生成设置」选择“海螺 Hailuo”。界面会填入官方 Base URL、模型与安全默认参数。
2. 只在应用表单中输入 API Key。主进程会写入用户数据目录的本地加密凭据文件；SQLite、renderer、日志和导出均不保存明文。
3. 先保留“启用 MiniMax Hailuo 生产渠道”关闭。这个开关对应默认参数 JSON 的
   `featureEnabled: true`；没有显式开启，即使存在有效密钥也不能创建计费任务。
4. 完成授权 sandbox 验收后再开启开关并设为默认 Provider。关闭开关会立刻阻止新建和重试，
   但不删除已有任务、归档结果或审计记录；仍可安全地停止本地跟踪。

推荐默认参数：

```json
{
  "duration": 6,
  "resolution": "768P",
  "prompt_optimizer": true,
  "featureEnabled": false
}
```

Hailuo 的 API 不接受独立的 negative prompt，应用不会把它拼接进用户的镜头 Prompt。
时长被限制为 6 或 10 秒；10 秒与 1080P 的不兼容组合会安全降为 768P，避免提交一个
已知无效的请求。

图生视频只接受 Hailuo 官方允许的公开 HTTPS 图片 URL 或 `data:image/...;base64,...` 值。
本地 `file:` 资产不会被应用偷偷上传；如果镜头引用了本地图片，提交会在本地以明确错误
停止，先把拥有授权的素材发布为可访问 URL 或选择文生视频。这个限制也避免把本地用户内容
无意发送给外部 Provider。

## 授权 sandbox 验收

真实 smoke 会创建一个会计费的 6 秒任务，因此只能由拥有账号、预算和内容授权的人员运行。
密钥必须通过受管的环境变量/CI secret 注入，不能写入 `.env`、命令参数、截图、日志或 issue。

在受控环境中运行：

```bash
bun run test:hailuo:sandbox
```

该命令要求受管环境同时提供 `HAILUO_SANDBOX_API_KEY` 与明确的
`HAILUO_SANDBOX_ALLOW_BILLING=1`。它验证：提交返回 `task_id`、10 秒轮询至成功、
`file_id` 换取 HTTPS 下载 URL，且下载 URL 可访问；测试不会将视频写入磁盘，也不会输出
task id、下载 URL、Prompt 或密钥。

若得到限流、余额不足、鉴权、参数或内容审核失败，界面会显示归一化原因。保存该次测试的
时间、环境授权人、模型、结果（成功或失败）和已脱敏 trace；不要保存密钥、原始 Prompt 或下载 URL。

## 故障处理与回滚

| 现象 | 用户可见行为 | 操作 |
| --- | --- | --- |
| 无密钥/开关关闭 | 提交前禁用并说明原因 | 在应用本地凭据库配置密钥；仅在完成验收后显式开启渠道。 |
| 1002 限流 | 任务失败并显示“限流” | 等待后由用户新建重试，避免自动形成额外计费。 |
| 1004/2049 鉴权 | 任务失败并显示凭据问题 | 在设置中更新本地凭据库密钥，不要在日志或终端粘贴。 |
| 1008 余额不足 | 任务失败并显示余额问题 | 在供应商控制台处理额度后再由用户重试。 |
| 1026/1027 内容审核 | 任务失败并说明内容审核 | 修改镜头描述或参考素材；不得绕过平台审核。 |
| 文件下载暂时失败 | 本地轮询保留并可再次查询 | 不新建远端任务；恢复网络后手动刷新同一任务。 |

紧急回滚只需关闭 `featureEnabled` 或删除 Hailuo 配置：这会停止新建/重试，但保留本地
任务、远端 id、已归档文件与审计证据。不要批量删除已创建的远端任务，因为官方文档没有
声明取消 API，删除本地记录也不能撤销已产生的供应商费用。
