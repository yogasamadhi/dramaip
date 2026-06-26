# ROADMAP.md

## 1. 项目长期目标

本项目长期目标是从“AI 短剧小说写作工作台”逐步升级为：

> 面向 AI 短剧的小说创作、小说改编剧本、分镜 Prompt 与视频平台对接工作台。

产品三大核心能力：

```txt
1. 写小说：创作适合 AI 短剧改编的中文小说。
2. 改剧本：把小说改编成 AI 短剧分集大纲和剧本。
3. 接视频：把剧本拆成分镜、镜头 Prompt，并对接 AI 视频平台。
```

完整链路：

```txt
创意 / 题材
  ↓
AI 短剧小说项目
  ↓
人物卡 / 世界观 / 大纲 / 章节正文
  ↓
小说短剧适配评分
  ↓
小说改编为分集大纲
  ↓
分集大纲改编为 AI 短剧剧本
  ↓
剧本拆分为场景和分镜
  ↓
镜头 Prompt / 负面 Prompt / 角色一致性提示
  ↓
AI 视频平台生成任务
```

整体演进路线：

```txt
v0.1 AI短剧小说写作工作台
v0.2 长篇一致性与视觉记忆系统
v0.3 AI短剧小说强化系统
v0.4 小说 / 大纲转 AI短剧分集大纲
v0.5 AI短剧剧本生成
v0.6 分镜与镜头 Prompt 生成
v0.7 AI视频平台对接
v0.8 多 Agent 编剧室与模板系统
v1.0 本地优先稳定版
```

v0.1 已在 `PROJECT_BRIEF.md` 中定义。本文档从 v0.2 开始描述。

---

# v0.2 长篇一致性与视觉记忆系统

## 目标

解决长篇小说写作过程中 AI 容易遗忘设定、人物崩坏、视觉不一致、前后矛盾的问题。

v0.2 的核心是：

> 让 AI 在长篇小说写作中记住人物、事件、伏笔和视觉设定。

---

## 核心功能

### 1. 章节摘要自动更新

每章生成或修改后，自动生成章节摘要。

```ts
export interface ChapterMemory {
  id: string
  projectId: string
  chapterId: string
  summary: string
  importantEvents: string[]
  characterChanges: string[]
  revealedSecrets: string[]
  newForeshadowing: string[]
  resolvedForeshadowing: string[]
  keyVisualElements: string[]
  createdAt: string
  updatedAt: string
}
```

### 2. 人物状态追踪

```ts
export interface CharacterState {
  id: string
  projectId: string
  characterId: string
  chapterId?: string
  currentStatus: string
  emotionalState?: string
  relationshipChanges?: string
  knownSecrets?: string[]
  hiddenSecrets?: string[]
  visualContinuityNotes?: string
  createdAt: string
}
```

用途：

* 记录人物关系变化。
* 避免角色秘密提前暴露。
* 避免人物状态前后矛盾。
* 为后续 AI 视频角色一致性服务。

### 3. 人物视觉档案

```ts
export interface CharacterVisualProfile {
  id: string
  projectId: string
  characterId: string

  appearancePrompt: string
  faceDescription?: string
  hairstyle?: string
  clothingStyle?: string
  bodyType?: string
  ageLook?: string
  temperament?: string
  colorPalette?: string
  negativePrompt?: string
  referenceImageUrl?: string

  createdAt: string
  updatedAt: string
}
```

### 4. 世界 / 场景视觉设定

```ts
export interface VisualSetting {
  id: string
  projectId: string
  title: string
  type: 'world' | 'location' | 'style' | 'object'
  visualPrompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### 5. 事件时间线

```ts
export interface StoryEvent {
  id: string
  projectId: string
  chapterId?: string
  title: string
  description: string
  eventType: 'conflict' | 'reveal' | 'reversal' | 'relationship' | 'foreshadowing' | 'payoff' | 'visual' | 'other'
  relatedCharacterIds: string[]
  orderIndex: number
  createdAt: string
}
```

### 6. 伏笔管理

```ts
export interface Foreshadowing {
  id: string
  projectId: string
  title: string
  setupChapterId?: string
  payoffChapterId?: string
  status: 'planned' | 'setup' | 'paid_off' | 'abandoned'
  description: string
  payoffPlan?: string
  relatedCharacterIds?: string[]
  createdAt: string
  updatedAt: string
}
```

### 7. 一致性检查

AI 检查当前章节是否违反：

```txt
人物设定
人物视觉设定
世界观设定
已发生事件
已揭露秘密
人物关系
时间线顺序
视觉连续性
伏笔状态
```

---

## LangGraph.js 工作流

新增 taskType：

```txt
summarize_chapter
update_character_state
extract_story_events
extract_foreshadowing
generate_character_visual_profile
generate_visual_setting
check_consistency
build_long_context
```

新增节点：

```txt
extractChapterMemoryNode
updateCharacterStateNode
extractStoryEventsNode
extractForeshadowingNode
generateVisualProfileNode
checkConsistencyNode
```

---

## 数据库新增表

```txt
chapter_memories
character_states
character_visual_profiles
visual_settings
story_events
foreshadowings
```

---

## 页面新增

```txt
记忆面板
人物状态页面
人物视觉档案页面
视觉设定页面
事件时间线页面
伏笔页面
一致性检查页面
```

---

## v0.2 验收标准

1. 每章可生成章节摘要。
2. 系统能记录人物状态变化。
3. 系统能提取关键事件。
4. 系统能记录伏笔。
5. 系统能生成人物视觉档案。
6. 系统能生成场景 / 世界视觉设定。
7. AI 生成新章节时能引用历史状态和视觉设定。
8. AI 能检查人物、设定、时间线和视觉连续性冲突。
9. 所有记忆数据保存到 SQLite。

---

# v0.3 AI短剧小说强化系统

## 目标

继续强化“写小说”这个核心能力，让小说在写作阶段就更适合未来改编成 AI 短剧。

v0.3 的核心是：

> 不是急着转剧本，而是让小说本身更短剧化、更视觉化、更适合后续 AI 视频生成。

---

## 核心功能

### 1. AI短剧适配趋势

统计全书趋势：

```txt
钩子强度趋势
冲突密度趋势
反转强度趋势
情绪强度趋势
结尾悬念趋势
画面可视化趋势
AI视频可行性趋势
角色一致性风险趋势
镜头清晰度趋势
```

### 2. 剧情节拍 Beat 管理

```ts
export interface Beat {
  id: string
  projectId: string
  chapterId?: string
  type: 'hook' | 'conflict' | 'reversal' | 'reveal' | 'emotion' | 'payoff' | 'cliffhanger' | 'visual'
  title: string
  description: string
  dramaValue: number
  visualValue: number
  orderIndex: number
  relatedCharacterIds?: string[]
  createdAt: string
}
```

用途：

* 将小说章节拆成戏剧节拍。
* 为后续分集和分镜做准备。
* 支持分析每章是否有足够画面动作。

### 3. 爽点分析

识别并统计爽点类型：

```txt
打脸
复仇
身份揭露
误会解除
强宠
反杀
逆袭
虐恋
追妻火葬场
真相曝光
权力压制
情绪爆发
```

### 4. AI视频可行性分析

分析小说内容是否适合未来 AI 视频生成：

```txt
角色数量是否过多
动作是否过于复杂
人物互动是否过密
场景是否过度跳跃
画面描述是否清晰
是否容易保持角色一致性
是否包含难生成元素
是否适合竖屏短剧
Prompt 是否可控
```

### 5. AI短剧化改写

针对某段小说，提供“AI短剧化改写”。

要求：

```txt
减少纯心理描写
增加人物动作
增加对白冲突
增加可视化场面
强化情绪爆点
强化结尾钩子
增强镜头可拆分性
保持小说可读性
```

---

## LangGraph.js 工作流

新增 taskType：

```txt
analyze_beats
analyze_highlights
analyze_ai_video_feasibility
enhance_hook
enhance_conflict
enhance_reversal
enhance_cliffhanger
rewrite_as_ai_drama_novel
analyze_project_ai_drama_trend
```

---

## 数据库新增表

```txt
beats
highlight_analyses
ai_video_feasibility_reports
drama_trend_reports
```

---

## 页面新增

```txt
AI短剧小说仪表盘
Beat 页面
爽点分析页面
AI视频可行性页面
短剧化改写面板
```

---

## v0.3 验收标准

1. 系统能从章节中提取剧情节拍。
2. 系统能分析章节爽点。
3. 系统能显示全书 AI 短剧适配趋势。
4. 系统能分析 AI 视频生成可行性。
5. 用户可以对章节执行 AI 短剧化改写。
6. AI 能给出钩子、冲突、反转、悬念、镜头清晰度优化建议。
7. 所有分析结果保存到 SQLite。

---

# v0.4 小说 / 大纲转 AI短剧分集大纲

## 目标

把已有小说项目或用户导入的大纲，转换成适合 AI 短剧剧本创作的分集大纲。

这是从“写小说”进入“改剧本”的第一步。

---

## 核心功能

### 1. 创建 AI短剧改编项目

```ts
export interface AdaptationProject {
  id: string
  sourceProjectId?: string
  title: string
  targetEpisodeCount: number
  episodeDuration?: string
  adaptationStyle: string
  visualStyleDirection?: string
  audience?: string
  createdAt: string
  updatedAt: string
}
```

### 2. 改编策略生成

AI 根据小说内容生成改编策略。

输出：

```txt
适合改编集数
核心卖点
主线保留建议
支线删减建议
人物合并建议
开篇重构建议
前 3 集爆点设计
整体节奏策略
视觉风格建议
AI视频生成风险
```

### 3. 分集大纲生成

```ts
export interface Episode {
  id: string
  adaptationProjectId: string
  episodeNumber: number
  title: string
  summary: string
  hook: string
  mainConflict: string
  reversal?: string
  emotionalBeat?: string
  cliffhanger: string
  keyVisuals?: string[]
  relatedChapterIds?: string[]
  relatedBeatIds?: string[]
  createdAt: string
  updatedAt: string
}
```

每集必须包含：

```txt
标题
一句话梗概
开场钩子
核心冲突
情绪爆点
关键反转
结尾悬念
关键画面
AI视频生成备注
```

### 4. 分集大纲编辑器

用户可以：

```txt
查看分集列表
编辑每集内容
调整集数顺序
合并分集
拆分分集
AI 重写某一集
AI 增强某一集钩子
AI 增强关键画面
```

### 5. 前 10 集重点优化

支持：

```txt
前 3 集爆点检查
前 10 集留存检查
前 10 集节奏评分
前 10 集反转密度检查
前 10 集视觉吸引力检查
```

---

## LangGraph.js 工作流

新增 taskType：

```txt
create_adaptation_strategy
convert_novel_to_episodes
generate_episode_outline
rewrite_episode_outline
enhance_episode_hook
enhance_episode_visuals
analyze_first_10_episodes
```

推荐 graph：

```txt
adaptation-strategy.graph.ts
episode-outline.graph.ts
first-ten-analysis.graph.ts
```

---

## 数据库新增表

```txt
adaptation_projects
episodes
episode_analyses
```

---

## 页面新增

```txt
改编项目页面
改编策略页面
分集大纲页面
前 10 集分析页面
```

---

## v0.4 验收标准

1. 从小说项目创建 AI 短剧改编项目。
2. 选择目标集数，如 24 / 40 / 60 / 80 集。
3. AI 生成改编策略。
4. AI 生成完整分集大纲。
5. 每集包含钩子、冲突、情绪爆点、反转、悬念、关键画面。
6. 用户可以编辑、重写、调整分集大纲。
7. 系统能分析前 10 集节奏和视觉吸引力。
8. 分集大纲保存到 SQLite。
9. 支持导出分集大纲 Markdown / JSON。

---

# v0.5 AI短剧剧本生成

## 目标

基于小说和分集大纲，生成适合 AI 视频平台使用的 AI 短剧剧本。

v0.5 的核心是：

> 把小说内容改编成一集一集的 AI 短剧剧本。

注意：此版本重点是剧本，不是直接生成视频 Prompt。
镜头 Prompt 放到 v0.6。

---

## 核心功能

### 1. AI短剧剧本

```ts
export interface Script {
  id: string
  adaptationProjectId: string
  episodeId: string
  episodeNumber: number
  title: string
  content: string
  estimatedDuration?: string
  createdAt: string
  updatedAt: string
}
```

剧本格式要求：

```txt
第 X 集：《标题》

本集钩子：
本集核心冲突：
本集情绪爆点：
本集反转：
本集结尾悬念：

场景一：地点 / 时间 / 人物

画面描述：
动作：
对白：
旁白：
AI视频备注：
```

### 2. 场景拆分

```ts
export interface Scene {
  id: string
  scriptId: string
  episodeId: string
  sceneNumber: number
  title: string
  location: string
  timeOfDay?: string
  visualDescription: string
  characters: string[]
  summary: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}
```

### 3. 剧本生成

AI 根据分集大纲生成剧本。

输入：

```txt
改编项目设定
原小说相关章节
人物卡
人物视觉设定
当前集分集大纲
前后集剧情
AI短剧风格要求
```

输出：

```txt
AI短剧剧本
```

### 4. 剧本审稿

AI 检查：

```txt
开场是否抓人
对白是否短剧化
冲突是否足够
画面是否清晰
场景是否清楚
人物是否符合设定
是否适合后续拆成镜头
是否适合 AI 视频生成
结尾是否有悬念
```

### 5. 剧本改写

支持：

```txt
增强对白冲突
增强情绪爆点
增强本集反转
增强集尾悬念
增强画面描述
增强 AI 视频可生成性
```

---

## LangGraph.js 工作流

新增 taskType：

```txt
generate_ai_drama_script
split_script_to_scenes
review_ai_drama_script
rewrite_ai_drama_script
enhance_dialogue_conflict
enhance_episode_cliffhanger
enhance_script_visuality
```

推荐 graph：

```txt
ai-drama-script.graph.ts
script-review.graph.ts
script-rewrite.graph.ts
```

---

## 数据库新增表

```txt
scripts
scenes
script_reviews
```

---

## 页面新增

```txt
AI短剧剧本页面
场景列表页面
剧本编辑器
剧本审稿面板
```

---

## v0.5 验收标准

1. 从分集大纲生成第 1 集 AI 短剧剧本。
2. 批量生成前 10 集 AI 短剧剧本。
3. 剧本包含画面描述、动作、对白、旁白。
4. 系统能拆分场景。
5. 系统能审稿并给出修改建议。
6. 用户可以执行剧本改写。
7. 剧本和场景数据保存到 SQLite。
8. 支持导出剧本 Markdown / JSON。

---

# v0.6 分镜与镜头 Prompt 生成

## 目标

基于 AI 短剧剧本，生成分镜、镜头描述、视频 Prompt 和负面 Prompt。

v0.6 的核心是：

> 把剧本变成 AI 视频平台可使用的镜头资产。

---

## 核心功能

### 1. 镜头拆分

```ts
export interface Shot {
  id: string
  sceneId: string
  episodeId: string
  shotNumber: number
  durationSeconds?: number

  visualDescription: string
  characterIds: string[]
  dialogue?: string
  narration?: string

  cameraAngle?: string
  cameraMovement?: string
  emotion?: string
  action?: string

  videoPrompt: string
  negativePrompt?: string
  imagePrompt?: string

  consistencyNotes?: string
  aiVideoDifficulty?: 'low' | 'medium' | 'high'

  createdAt: string
  updatedAt: string
}
```

### 2. 镜头 Prompt 生成

每个镜头生成：

```txt
视频 Prompt
负面 Prompt
角色一致性提示
场景一致性提示
镜头运动
情绪表达
动作描述
画面风格
```

### 3. 分镜审查

AI 检查：

```txt
镜头是否过长
人物数量是否过多
动作是否过于复杂
画面描述是否明确
角色一致性风险
场景连续性风险
Prompt 是否可控
是否适合竖屏短剧
```

### 4. Prompt 改写

支持：

```txt
增强画面感
降低生成难度
增强角色一致性
增强镜头运动
生成更适合某视频平台的 Prompt
```

---

## LangGraph.js 工作流

新增 taskType：

```txt
split_scene_to_shots
generate_shot_prompt
generate_negative_prompt
review_shot_prompt
rewrite_shot_prompt
optimize_prompt_for_video_platform
```

推荐 graph：

```txt
shot-split.graph.ts
shot-prompt.graph.ts
prompt-review.graph.ts
```

---

## 数据库新增表

```txt
shots
shot_reviews
prompt_versions
```

---

## 页面新增

```txt
分镜页面
镜头列表页面
镜头 Prompt 编辑器
Prompt 审查面板
```

---

## v0.6 验收标准

1. 从剧本场景拆分镜头。
2. 为每个镜头生成视频 Prompt。
3. 为每个镜头生成负面 Prompt。
4. 系统能审查镜头生成难度。
5. 用户可以优化 Prompt。
6. 镜头和 Prompt 数据保存到 SQLite。
7. 支持导出镜头 Prompt Markdown / JSON / CSV。

---

# v0.7 AI视频平台对接

## 目标

接入 AI 视频生成平台，实现从镜头 Prompt 到视频生成任务的半自动流程。

---

## 核心功能

### 1. 视频生成 Provider 抽象

```ts
export interface VideoProvider {
  createTask(input: VideoGenerationInput): Promise<VideoGenerationTask>
  getTaskStatus(taskId: string): Promise<VideoGenerationTask>
}
```

### 2. 视频生成任务

```ts
export interface VideoGenerationTask {
  id: string
  projectId: string
  episodeId?: string
  sceneId?: string
  shotId?: string

  provider: string
  model: string
  prompt: string
  negativePrompt?: string
  referenceImageUrls?: string[]

  status: 'pending' | 'running' | 'success' | 'failed'
  resultVideoUrl?: string
  errorMessage?: string

  createdAt: string
  updatedAt: string
}
```

### 3. 生成任务管理

支持：

```txt
选择视频生成模型
提交镜头 Prompt
记录生成任务
查询生成状态
保存生成结果
失败重试
对比多个生成结果
人工选择最佳镜头
```

### 4. 按集管理视频片段

页面按：

```txt
项目
集数
场景
镜头
生成任务
生成结果
```

组织视频片段。

---

## LangGraph.js 工作流

新增 taskType：

```txt
create_video_generation_task
check_video_generation_status
retry_video_generation_task
compare_video_results
select_best_video_result
```

推荐 graph：

```txt
video-generation.graph.ts
video-result-review.graph.ts
```

---

## 数据库新增表

```txt
video_generation_tasks
video_results
```

---

## 页面新增

```txt
视频生成配置页面
镜头生成任务页面
视频结果页面
按集视频片段页面
```

---

## v0.7 验收标准

1. 用户可以选择视频生成 Provider。
2. 用户可以把某个镜头 Prompt 提交为视频生成任务。
3. 系统能记录任务状态。
4. 系统能保存生成结果。
5. 用户可以对同一镜头生成多个结果。
6. 用户可以选择最佳结果。
7. 所有任务和结果保存到 SQLite。

---

# v0.8 多 Agent 编剧室与模板系统

## 目标

让项目从单一 AI 工作流升级为可扩展的 AI 小说、剧本与 Prompt 工作台。

---

## 核心功能

### 1. 多 Agent 编剧室

预设 Agent：

```txt
小说主编 Agent
短剧策划 Agent
爽点优化 Agent
人物关系 Agent
视觉导演 Agent
分镜导演 Agent
Prompt 工程师 Agent
合规审查 Agent
剧本医生 Agent
```

### 2. Agent 协作流程

示例：

```txt
小说主编生成章节
↓
爽点优化 Agent 提建议
↓
人物关系 Agent 检查人设
↓
短剧策划 Agent 检查钩子和悬念
↓
视觉导演 Agent 检查画面感
↓
Prompt 工程师 Agent 检查视频 Prompt 可控性
↓
小说主编整合修改
```

### 3. 模板系统

支持模板类型：

```txt
项目模板
人物模板
大纲模板
章节模板
AI短剧评分模板
分集大纲模板
视频剧本模板
分镜模板
镜头Prompt模板
Pitch模板
```

```ts
export interface Template {
  id: string
  name: string
  type: string
  description?: string
  content: string
  variables: string[]
  createdAt: string
  updatedAt: string
}
```

### 4. 类型库

内置 AI 短剧类型库：

```txt
女频复仇
真假千金
重生逆袭
霸总追妻
先婚后爱
豪门恩怨
赘婿打脸
战神归来
悬疑反转
古装权谋
玄学直播
```

每个类型包含：

```txt
常见人物关系
常见爽点
常见反转
常见开局
常见结尾钩子
常见视觉风格
镜头Prompt建议
AI视频生成风险
```

---

## LangGraph.js 工作流

新增：

```txt
multi-agent-writing-room.graph.ts
template-driven-generation.graph.ts
agent-review.graph.ts
prompt-engineer-review.graph.ts
```

新增 Agent 配置：

```ts
export interface AgentProfile {
  id: string
  name: string
  role: string
  systemPrompt: string
  outputSchema?: string
  enabled: boolean
}
```

---

## 数据库新增表

```txt
agent_profiles
templates
template_runs
genre_presets
```

---

## 页面新增

```txt
编剧室页面
Agent 配置页面
模板管理页面
类型库页面
```

---

## v0.8 验收标准

1. 用户选择一个章节执行多 Agent 审稿。
2. 不同 Agent 给出不同角度意见。
3. 系统整合 Agent 意见生成修改建议。
4. 用户可以创建和使用自定义模板。
5. 用户可以基于短剧类型模板生成项目。
6. 所有 Agent 和模板配置保存到 SQLite。

---

# v1.0 本地优先稳定版

## 目标

形成一个可公开发布的稳定版本。

v1.0 要求：

```txt
功能稳定
数据安全
体验完整
文档清晰
可安装
可迁移
可开源发布
```

---

## v1.0 重点工作

### 1. 数据迁移

实现数据库 migration 管理。

要求：

```txt
从 v0.1 升级到 v1.0 数据不丢失
每个版本有明确 migration
```

### 2. 本地备份

支持：

```txt
导出完整项目包
导入完整项目包
自动备份 SQLite
```

### 3. 模型配置增强

支持：

```txt
多个文本模型配置
多个视频模型配置
默认模型
不同任务使用不同模型
模型连接测试
token 和耗时统计
```

### 4. 错误处理

完善：

```txt
模型调用失败提示
JSON 解析失败修复
数据库异常提示
导出失败提示
视频生成失败提示
```

### 5. 安装包

支持：

```txt
macOS
Windows
```

Linux 可选。

### 6. 文档

需要文档：

```txt
README.md
PROJECT_BRIEF.md
ROADMAP.md
CONTRIBUTING.md
DEVELOPMENT.md
PROMPT_GUIDE.md
AI_VIDEO_GUIDE.md
```

---

## v1.0 验收标准

1. 用户可以完整完成 AI 短剧小说创作。
2. 用户可以从小说生成 AI 短剧分集大纲。
3. 用户可以生成前 10 集 AI 短剧剧本。
4. 用户可以生成分镜和镜头 Prompt。
5. 用户可以对接 AI 视频平台。
6. 应用可以正常安装、启动、保存和恢复数据。
7. AI 调用失败时不会导致数据丢失。
8. 所有核心功能有基础文档。
9. 代码结构清晰，适合开源维护。

---

# 长期可选方向

v1.0 之后可以考虑：

```txt
云同步
团队协作
Web 版
私有部署
插件系统
模板市场
Prompt 市场
中文 AI 短剧数据集
本地模型支持增强
向量数据库检索
短剧投流素材文案生成
海外 AI 短剧本地化改编
自动配音
自动字幕
自动剪辑
成片管理
```

这些不进入 v1.0 主线，避免过早复杂化。
