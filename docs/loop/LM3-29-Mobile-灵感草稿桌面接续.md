# LM3-29：移动灵感、草稿与桌面接续

## 交付边界

- `inspiration-service` 独占 `inspiration.mobile_drafts` 与 `mobile_draft_adoptions`；Mobile/Desktop BFF 只经 mTLS gRPC 调用。
- 移动端将轻量灵感、人物草稿或项目方向加入本地离线队列，并以设备生成的 `client_id` 重放。重复网络请求只会得到同一服务端草稿。
- 桌面端先读取当前登录用户的队列，再由用户明确点击采用。采用只写入当前本地项目的灵感台收藏卡，保留来源提示；不会写入或覆盖章节正文。
- AI 扩写最多提交 1,500 个字符，沿用 AI Gateway 的模型、额度、结算和幂等边界。BFF 不拥有 Provider 或支付凭据。

## 隐私与离线规则

- refresh token 继续只放 iOS Keychain / Android Keystore；access token 只在运行时内存。
- 草稿不是会话凭据，可存在 AsyncStorage。失败重放不删除本地草稿；用户还可导出 JSON 交接包并在桌面端原有导入入口中使用。
- “语音”指系统键盘听写的文字标记。应用不录制、不存储、不上传原始音频。
- AI 仅获取用户在扩写面板确认的短文本；不传项目数据库、文件路径、设备信息、原始音频或完整正文。

## 回滚与运行验证

- 回滚可关闭 Mobile/Desktop 云端入口；已在本地保存的草稿与已导入桌面灵感卡不受影响，服务端审计行保留。
- 不把此能力当作通用项目同步：项目云同步、正文合并和跨设备冲突处理仍由 LM3-35 实现。
- 运行时设备验证需要健康的 Kong、Mobile BFF、Desktop BFF、inspiration-service 和 AI Gateway。当前工作区已有 Compose `localhost:8000` 不健康，未被启动、停止、重建或删除；因此本轮只记录单元、协议、静态部署与 bundle 证据。
- 不执行真实付款、支付 Provider 或 AI Provider 调用。健康测试环境在具备受控 Provider 凭据和额度策略后，可验证一次短文本扩写、离线后重放、桌面采用和重复采用审计。
