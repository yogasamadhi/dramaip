# 阿里云百炼 Wan 视频 Provider 运行手册

本手册覆盖 Desktop 的第二个国内真实视频渠道：阿里云百炼 Wan。它只描述已实现的
`wan` adapter；该渠道与 MiniMax Hailuo 使用独立账号、密钥、Feature Flag、任务端点和
回滚边界。

## 选择与能力边界

Wan 采用 DashScope 的异步任务协议：创建任务后保存 `task_id`，轮询到
`SUCCEEDED` 时读取短期有效的 `video_url` 并立即归档到本机。官方还提供
`POST /tasks/{task_id}/cancel`，但只允许取消仍处于 `PENDING` 队列状态的任务；任务已
运行时应用会明确返回取消失败并保持本地任务可轮询，绝不伪造“已取消”。

- 官方文生视频指南：[Wan 文生视频](https://help.aliyun.com/zh/model-studio/text-to-video-guide)
- 官方图生视频参考：[Wan 2.7 图生视频](https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference)
- 官方任务管理：[查询与取消异步任务](https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks)

默认北京地域 Base URL 为 `https://dashscope.aliyuncs.com/api/v1`。若账号使用业务空间专属
域名，须在设置中填入同一地域的完整 API 根路径，并确保模型、API Key 和端点属于同一地域。
默认文生视频模型是 `wan2.7-t2v-2026-06-12`；引用首帧或首尾帧时，adapter 使用默认参数
里的 `imageModel`（默认 `wan2.7-i2v-2026-04-25`）。本地 `file:`、`data:` 或非 HTTPS 的
参考图不会自动上传。

## 安全配置与生产开关

1. 在「设置 → 视频生成设置」选择“阿里云百炼 Wan”。
2. 仅在表单输入百炼 `DASHSCOPE_API_KEY`。主进程把它写入系统钥匙串；SQLite、renderer、日志、导出和任务元数据均不保存明文。
3. 初始保持“启用阿里云百炼 Wan 生产渠道”关闭。只有默认参数 JSON 中的
   `featureEnabled: true` 才允许创建或重试会计费的真实任务。
4. 关闭开关会阻止新任务，但不会删除已存在的任务、远端 id、结果或审计；对已排队任务，若密钥仍可用，可尝试官方远端取消。

推荐默认参数：

```json
{
  "duration": 10,
  "resolution": "720P",
  "ratio": "9:16",
  "prompt_extend": true,
  "watermark": true,
  "imageModel": "wan2.7-i2v-2026-04-25",
  "featureEnabled": false
}
```

Wan 的成功 `video_url` 只保留约 24 小时，Desktop 主进程在成功轮询后立即下载到本地项目资产目录；下载失败时保留远端 URL 和 `archiveError`，方便在有效期内手动刷新同一任务，绝不重复提交。

## 授权 sandbox 验收

真实 smoke 会创建一个会计费视频，因此只能在拥有账号、预算和内容授权的受控环境执行：

```bash
pnpm test:wan:sandbox
```

该命令要求受管环境提供 `WAN_SANDBOX_API_KEY` 和明确的
`WAN_SANDBOX_ALLOW_BILLING=1`。它提交一个无害测试镜头、每 15 秒轮询直到终态、验证
`video_url` 可访问，并丢弃响应体；不会写入视频，不会输出任务 id、URL、Prompt 或密钥。
请记录测试时间、授权环境、模型、是否成功及脱敏 trace，不要保存密钥或原始请求。

## 故障处理与回滚

| 现象 | 用户可见行为 | 操作 |
| --- | --- | --- |
| 无密钥或开关关闭 | 提交前禁用并说明原因 | 在钥匙串更新同地域密钥；只有验收后才开启。 |
| `InvalidApiKey` | 显示鉴权或地域不匹配 | 核对业务空间、地域和钥匙串引用，不要粘贴密钥到日志。 |
| `Throttling.RateQuota` | 显示限流 | 等待后由用户新建重试，避免自动重复计费。 |
| `QuotaExhausted` | 显示额度不足 | 在百炼控制台处理额度，再由用户重试。 |
| 内容审核或参数错误 | 显示审核/参数原因 | 调整镜头描述、模型、时长、分辨率或 HTTPS 参考图。 |
| 取消请求被拒绝 | 保持本地任务可轮询 | 任务可能已开始；百炼只允许取消 `PENDING` 任务。 |

紧急回滚：关闭 `featureEnabled` 或删除 Wan 配置即可阻止新建和重试，且保留所有本地审计与已归档结果。不要删除本地任务来假定远端任务已取消；远端取消只能通过上述官方队列态接口确认。
