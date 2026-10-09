# AI 视频生成链路指南

本文档说明[当前产品定位](../../../docs/product/POSITIONING.md)中的生产出口：把已经采用的故事母本或剧本推进为分镜、镜头 Prompt、媒体试制和交付。视频 Provider 是可替换的生产供应商，不是产品权威内容来源，也不改变尽意以编剧、IP 改编、连续性和作者控制为核心的定位。

以下链路覆盖从小说到 AI 视频的完整生产路径（v0.5–v0.7）：剧本 → 分镜 → 镜头 Prompt → 视频平台对接，以及各平台 Prompt 要点、竖屏短剧建议、生成风险。已有剧本的项目可以跳过小说阶段直接进入对应环节。

这是用户选择媒体制作后的可选路径，不是所有项目的完成标准。小说可以停在章节、稿件或投稿交付，创意也可以直接开发剧本。下文 v0.x 名称与体量约定保留旧设计语境，“一章两集”“两分钟一集”和章字数不是当前所有类型的硬规则；按实际改编目标和情节密度确认。规则/模型风险与留存分析是创作参考，不是实测受众留存、必然能拍或最终成片证明。具体 Provider、渲染和导出能力以当前实现及发布证据为准。

## 完整链路

```
小说项目（项目/人物/大纲/章节/评分/视觉档案；单章 ≈ 2000 字，为小说网发布优化）
  └─ v0.4 分集大纲：小说 → AdaptationProject → Episode[]（默认「1 章 → 2 集」，每集 2 分钟；允许 ±1 集浮动）
      └─ v0.5 剧本：Episode → Script（2 分钟一集的短剧剧本）→ Scene[]（拆场景）
          └─ v0.6 分镜：Scene → Shot[]（拆镜头）
              └─ v0.6 镜头 Prompt：每个 Shot → videoPrompt + negativePrompt + 视觉描述
                  └─ v0.7 视频生成：Shot Prompt + 平台 → VideoGenerationTask → VideoResult
```

每个环节都有 AI 任务 + 预览 + 落库，失败有提示、数据不丢失。

> v1.1 起，视频生成风险会前置到创意诊断台和分镜页：`analyze_video_cost_risk` 会在小说、剧本、场景或镜头阶段提前标出复杂动作、多人群像、时空切换、特效和角色一致性风险；`run_quality_gate` 可在进入视频生成前给出 pass / warn / block 结论。

> **体量体系**：小说侧（单章 ≈ 2000 字）服务阅读与发布；剧本侧（1 集 = 2 分钟）服务视频节奏。两者是独立体量，经「改编」衔接，「1 章 → 2 集」是基于情节密度的改编约定，不是字数换算。

## 各环节要点

### 1. 分集大纲（v0.4）

- `create_adaptation_strategy`：根据小说生成改编策略（集数、节奏、爽点分布）。
- `convert_novel_to_episodes`：生成分集大纲，每集含钩子/冲突/反转/结尾悬念。
- `analyze_first_10_episodes`：分析前 10 集留存曲线。
- **章↔集对应**：默认「1 章小说 → 2 集短剧」（第 1 铺冲突+悬念、第 2 推爆点+反转），允许按情节密度 ±1 集浮动。创建改编时默认集数 = 章数 × 2，用户可调。
- **短剧要点**：前 3 集爆点要强、每集结尾留悬念（cliffhanger）、爽点密度高。

### 2. 剧本（v0.5）

- `generate_ai_drama_script`：单集剧本，短剧化对白（短、狠、快）。
- `split_script_to_scenes`：拆场景（每个场景有地点、人物、动作、对白）。
- `review_ai_drama_script` / `rewrite_ai_drama_script`：剧本审稿与改写。
- 增强类：`enhance_dialogue_conflict`（对白冲突）、`enhance_episode_cliffhanger`（集尾悬念）、`enhance_script_visuality`（视觉性）。

### 3. 分镜与镜头 Prompt（v0.6）

- `split_scene_to_shots`：场景 → 镜头清单（机位/运动/画面/情绪/动作/对白/旁白）。
- `generate_shot_prompt`：每镜头生成视频 Prompt（画面描述 + 风格 + 镜头语言）。
- `generate_negative_prompt`：负面 Prompt（规避崩坏元素）。
- `review_shot_prompt` / `rewrite_shot_prompt`：审查与改写。
- `optimize_prompt_for_video_platform`：按目标平台优化（各平台 Prompt 语法不同）。
- **镜头 Prompt 要素**：主体（谁）+ 动作（做什么）+ 场景（在哪）+ 光影氛围 + 镜头语言（景别/运动）+ 风格关键词。

## 视频平台对接（v0.7）

在「视频生成设置」配置 Provider（baseUrl / apiKey / 模型名）。`Mock` 用于本地全链路验证；`Custom` 走 OpenAI-compatible 风格的 HTTP 提交/查询协议；`OpenAI Sora`、`海螺 Hailuo` 与 `阿里云百炼 Wan` 已接入官方接口；即梦、可灵、Runway、Pika 保持独立 adapter 槽位，需按平台文档补齐鉴权、请求路径、状态映射和错误归一化后再启用真实调用。

- 镜头工作台选 Shot → 选 Provider → 创建 `VideoGenerationTask`（提交到平台轮询）。
- 结果回写 `VideoResult`，可标记「最佳」。
- 状态：pending → processing → success / failed。

### Provider Adapter 边界（L5-01）

- `mock`：不访问外部网络，立即返回合成结果，适合 smoke 和无账号演示。
- `custom`：使用 `/video/generations` 与 `/video/generations/{id}` 的 OpenAI-compatible 风格 adapter，支持 Bearer Key、请求重试、状态映射和结果保存。
- `openai_sora`：默认 Base URL 为 `https://api.openai.com/v1`，创建任务 `POST /videos`，轮询 `GET /videos/{video_id}`，完成后保存 `GET /videos/{video_id}/content` 作为结果端点。默认参数建议 `{"size":"720x1280","seconds":"8"}`，模型默认为 `sora-2`。接口依据 [OpenAI 视频生成指南](https://developers.openai.com/api/docs/guides/video-generation) 和 [Videos API Reference](https://developers.openai.com/api/reference/resources/videos)。
- `hailuo`：默认 Base URL 为 `https://api.minimaxi.com`，创建任务 `POST /v1/video_generation`，轮询 `GET /v1/query/video_generation?task_id=...`，成功后用 `GET /v1/files/retrieve?file_id=...` 解析临时下载 URL 并归档本机。默认参数建议 `{"duration":6,"resolution":"768P","prompt_optimizer":true,"featureEnabled":false}`；`featureEnabled` 是明确的计费渠道开关，默认关闭。完整配置、sandbox 验收、错误码和回滚见 [Hailuo Provider 运行手册](./HAILUO_VIDEO_PROVIDER_RUNBOOK.md)。
- `wan`：默认 Base URL 为 `https://dashscope.aliyuncs.com/api/v1`，创建任务 `POST /services/aigc/video-generation/video-synthesis`（`X-DashScope-Async: enable`），轮询 `GET /tasks/{task_id}`，成功后直接归档响应的短期 `video_url`。默认参数建议 `{"duration":10,"resolution":"720P","ratio":"9:16","prompt_extend":true,"watermark":true,"imageModel":"wan2.7-i2v-2026-04-25","featureEnabled":false}`；首帧/首尾帧参考会转用 `imageModel`，且仅接受 HTTPS URL。Wan 只对 `PENDING` 队列任务发送官方远端取消；运行中的任务保留可轮询状态。完整配置、sandbox 验收、错误码和回滚见 [Wan Provider 运行手册](./WAN_VIDEO_PROVIDER_RUNBOOK.md)。
- 其他真实平台：每个平台在 `packages/ai/src/providers/video/adapters.ts` 有独立 adapter 注册位；在未完成平台专用映射前，会返回明确的“真实 API 映射尚未启用”错误，不再误走 `custom` 的通用端点。
- 后续落地其他真实平台时，只填对应 adapter 的 `authHeaders`、`createTaskRequest`、`getTaskStatusRequest`、`mapTaskState` 和 `normalizeError`，不修改 mock/custom/Sora 行为。

> 注意：OpenAI Sora 的内容下载端点需要 Bearer Key；L5-03 起由主进程在归档下载时临时附加鉴权，渲染层只播放本地归档文件或保留远端诊断 URL。

### 视频结果本地归档（L5-03）

- 视频任务成功后，主进程会尝试把远端视频和封面保存到 `userData/assets/projects/<projectId>/video-results/<taskId>/`。
- `VideoResult` 同时记录本地路径（`localVideoPath` / `localCoverImagePath`）和远端 URL（`remoteVideoUrl` / `remoteCoverImageUrl`）；UI 优先播放本地 `file://` 资源，归档失败时保留远端 URL 和 `archiveError`。
- OpenAI Sora content endpoint 下载时会在主进程临时附加 Bearer Key，不会把 Key 写入文件、URL、日志或 `rawMeta`。
- 当前 `.sdnspkg` 项目包默认不内嵌视频二进制资产，也不把本机绝对资产路径作为跨设备可恢复承诺；导入包后仍可凭远端 URL 诊断/重下。
- 本地资产库统一使用 `userData/assets/projects/<projectId>/library/<kind>/` 作为项目资产目录，并通过 `project_assets` 表记录角色参考图、场景图、视频结果、封面等资产清单。
- 项目包已支持资产清单策略：默认 `assetExportMode=none`；调用导出时显式传入 `includeAssets` 才会写入 `assetExportMode=manifest` 和可随包携带的资产记录。当前清单只保存引用和元数据，不写入二进制；导入到新设备后本地路径会标记为 `missing`，远端 URL 可用时标记为 `remote_only`。

### 各平台 Prompt 风险

不同平台对 Prompt 的解析与可控性差异大，常见风险（内置类型库已为每个类型标注 `aiVideoRisks`）：

| 风险 | 说明 | 建议 |
|---|---|---|
| 角色一致性 | 同人物跨镜头外观漂移 | 强化角色外观 Prompt 关键词，多用特写 |
| 多人群像 | 人物多时易混淆、表情崩 | 控制单镜头人物数（建议 ≤2-3） |
| 复杂动作 | 打斗、奔跑等生成困难 | 拆成静态/简单动作，关键动作慢镜 |
| 时空切换 | 回忆/现实切换连续性差 | 用色调/转场区分，重生瞬间给强反应特写 |
| 灵异特效 | 光效/粒子不稳定 | 避免过度特效，用氛围光雾替代 |

### 视频风险前置（v1.1）

- 在「创意诊断台」可对项目或当前章节运行「视频风险」。
- 在「分镜与镜头 Prompt」页可对单镜头运行「视频风险」，结果写入质量闸门报告。
- 风险报告中的 cost 代表生成难度、失败概率和返工成本，不代表真实人民币成本。
- 若报告为 block，应先拆分镜头、减少同镜人物、简化动作或替换高不稳定特效。

## 竖屏短剧建议（9:16）

- 构图以中近景、特写为主（竖屏空间有限，大景别浪费）。
- 单镜头时长短（2-4 秒），快切增强节奏。
- 人物表情/眼神是情绪主载体，多给特写。
- 文字/字幕避开安全区边缘。
- 视觉风格尽量统一（同一项目的视觉风格方向在项目设定里维护，分镜生成时会带入）。

## 模型选择（v1.0）

不同环节对模型需求不同，可在「模型设置 → 按任务指定模型」为各任务组选不同模型：

- **剧本/分镜（script/shot 组）**：创意与画面感强的大模型。
- **分析类（analysis 组）**：可用更快的模型降本。
- 详见 Token 与耗时统计页跟踪用量与成本。
