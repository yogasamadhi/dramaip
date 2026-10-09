# Troubleshooting

本手册服务 [当前产品定位](../../../docs/product/POSITIONING.md) 下的小说创作与改编两条路径。小说可以独立续写和导出，不需要配置媒体 Provider；本地优先不等于离线 AI。没有模型连接时不能声称发生了真实生成，工程恢复成功也不保证内容质量。

| Symptom                          | Action                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Server 未能启动”                | Choose retry. If it repeats, collect the desktop logs and verify the `userData` directory is writable.                                                                           |
| Agent reports engine unavailable | Project, chapter and production features remain available. Restart the app to restart the Pi, Codex or LangGraph.js Host adapter; it will not silently switch to another engine. |
| 保存出现版本冲突                 | 当前草稿仍保存在本机。打开候选差异，将生成依据、当前正文和候选正文合并；确认后会建立新的待确认候选，不要通过刷新丢弃草稿。                                                       |
| 本地创作服务无法连接             | 点击“重新连接”。编辑器恢复草稿按章节和编辑会话保留；连接恢复前不要清除应用数据。若重复失败，可重新加载应用并从“设置 → 高级诊断”导出脱敏诊断信息。                                |
| 视频任务失败，需要重试           | 从任务中心返回原视频操作。应用会恢复原服务商和提示词；重新执行静帧、资产、权利与费用预检并确认后，才会建立关联原任务的新执行记录。                                               |
| 已取消或已处理任务仍显示在首页   | 在任务中心确认其提醒状态。主动取消应位于历史；失败任务可“标记为已处理”。若成功重试后旧提醒仍存在，请重新连接以重放持久事件。                                                     |
| An asset cannot be imported      | Choose the file again. Capability tokens are read-only, renderer-bound and expire after ten minutes.                                                                             |
| 服务商密钥无法保存               | 检查应用数据目录是否可写；密钥仅保存到本地加密凭据库，业务记录中只保存 `credentialRef`。                                                                                         |
| 升级后旧密钥无法使用             | 本版本不会访问或迁移 macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service；请在“设置 → 安全凭据”重新保存服务商密钥，并重新登录 Codex。                                        |

There is no `better-sqlite3` rebuild step and no historical database migration path in v3.


## AI 创作工作流

| 情况 | 处理方式 |
| --- | --- |
| AI 连接尚未配置 | 要求保留在当前项目与目标下。进入 AI 连接验证，再返回原动作重新点击生成；不会自动发起调用或切换引擎。 |
| 引擎只返回聊天文本 | 内容协议解析失败，任务显示需要处理。保留原结果，不伪造可采用候选。 |
| 已取消，但稍后仍收到结果 | 被取消运行的迟到事件被隔离。重试创建关联原任务的新运行，沿用原模型、输入与上下文快照。 |
| 重启后运行无法恢复 | 保留阶段、运行、快照及已有输出；从任务中心重试或保留候选重新检查。无法恢复的引擎会明确报错，不默认换模型。 |
| 来源版本已变化 | 章节和剧本可在采用时比较冲突；其他方案请按当前资料生成新候选。不要通过直接覆盖绕过版本检查。 |
| 故事资料提取失败 | 定稿已保留。到任务中心查看关联故事记忆任务并沿用原输入重试；状态恢复后才显示已同步。 |
| 审片采用后仍有问题 | 查看采用后复检报告。报告属于该剧本版本，原审片意见保留，不会因为一次模型回复自动关闭。 |
| 导出字幕提示缺少时间信息 | 先导出译文草稿 TXT，或导入已对齐字幕；没有音轨时间信息时不能得到可靠 SRT/VTT。 |
| 旧任务没有真实 AI 执行记录 | 旧反馈说明任务和导入修改稿保留原性质；请在当前对象发起新的 AI 修订，不把历史说明当成生成结果。 |
