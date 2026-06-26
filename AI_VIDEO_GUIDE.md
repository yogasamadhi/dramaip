# AI 视频生成链路指南

本文档说明从小说到 AI 视频的完整创作链路（v0.5–v0.7）：剧本 → 分镜 → 镜头 Prompt → 视频平台对接，以及各平台 Prompt 要点、竖屏短剧建议、生成风险。

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

在「视频生成设置」配置 Provider（baseUrl / apiKey / 模型名）。支持 OpenAI-compatible 视频生成协议。

- 镜头工作台选 Shot → 选 Provider → 创建 `VideoGenerationTask`（提交到平台轮询）。
- 结果回写 `VideoResult`，可标记「最佳」。
- 状态：pending → processing → success / failed。

### 各平台 Prompt 风险

不同平台对 Prompt 的解析与可控性差异大，常见风险（内置类型库已为每个类型标注 `aiVideoRisks`）：

| 风险 | 说明 | 建议 |
|---|---|---|
| 角色一致性 | 同人物跨镜头外观漂移 | 强化角色外观 Prompt 关键词，多用特写 |
| 多人群像 | 人物多时易混淆、表情崩 | 控制单镜头人物数（建议 ≤2-3） |
| 复杂动作 | 打斗、奔跑等生成困难 | 拆成静态/简单动作，关键动作慢镜 |
| 时空切换 | 回忆/现实切换连续性差 | 用色调/转场区分，重生瞬间给强反应特写 |
| 灵异特效 | 光效/粒子不稳定 | 避免过度特效，用氛围光雾替代 |

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
