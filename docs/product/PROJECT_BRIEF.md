# 尽意 DramaIP 项目定义

> **尽作者之意，成万象之作**
>
> 面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台

## 1. 项目定位

当前统一定位见[产品定位](./POSITIONING.md)（2026-09-30 校准）。本项目面向原创作者和小型内容团队，持续发展小说与故事母本，或把创意、已有小说、大纲和剧本推进为分集剧本、分镜与交付包。作者意图、叙事质量、连续性、版本与来源贯穿两条价值链。

产品总核心是故事/IP 的持续开发与权威内容资产：

```text
故事/IP 的持续开发与权威内容资产（总核心）
  ├─ 小说与故事母本创作 → 章节、完整稿件与投稿成果
  ├─ 短剧/漫剧改编与剧本开发 → 分集剧本、分镜与试制交付
  └─ 作者意图、叙事质量、连续性、版本、来源与采用（贯穿两路）
```

尽意 DramaIP 不是通用小说写作软件、单镜头视频生成器或传统真人剧组管理工具。用户可以从创意、已有小说或已有剧本进入；小说写作是完整的一等能力，但不是所有项目的强制步骤。图片、TTS 和视频平台通过 Provider-neutral、BYOK 的方式连接，不成为产品定位本身。

小说用户可以只写作、续写和导出，不进入改编；从创意开始也可以直接开发剧本。小说质量按作者的文风与叙事目标衡量，不默认要求短剧化或机械反转。本地优先指作品与记录归属，不承诺模型离线推理。

面向改编市场的英雄流程目标是（不替代独立小说闭环）：

```txt
导入小说或大纲
  ↓
改编诊断与整季分集方案
  ↓
首集标准剧本
  ↓
首集分镜试制包与交付
```

本节以上定义当前产品取舍，不代表所有目标已经实现。当前实施顺序见 [PLAN](../PLAN.md)，实现与发布事实见 [Desktop README](../../desktop/README.md) 和 [Platform README](../../platform/README.md)。以下第 2 节起的 v0.1 内容全部为早期历史基线，含当时技术选型、工作流和数据模型，不再作为现行架构或命令依据。v0.1 当时只做第一阶段：

> AI 短剧小说写作工作台。

v0.1 的重点是让用户可以认真写一部适合 AI 短剧改编的小说，而不是只生成 Prompt。

---

## 2. v0.1 核心目标

v0.1 必须实现：

1. 创建 AI 短剧小说项目。
2. 管理人物卡。
3. 管理大纲。
4. 管理章节。
5. 使用 AI 生成、续写、改写、润色小说正文。
6. 使用 AI 评估小说章节是否适合未来改编为 AI 短剧。
7. 为后续“小说改编剧本、剧本转分镜、分镜转视频 Prompt”预留数据结构。

v0.1 不做完整小说转剧本，不做完整分镜，不直接接入 AI 视频平台。

---

## 3. v0.1 核心功能

必须实现：

1. 项目管理：创建、编辑、删除、打开项目。
2. 人物卡管理：创建、编辑、删除人物。
3. 大纲管理：创建全书大纲、章节大纲。
4. 章节编辑：创建章节、编辑正文、自动保存。
5. 模型配置：支持 OpenAI-compatible API。
6. LangGraph.js 工作流：统一管理 AI 生成流程。
7. AI 小说写作：生成项目设定、人物、全书大纲、章节大纲、章节正文。
8. AI 辅助写作：续写、改写、润色、扩写、增强冲突、增强爽点、增强 AI 短剧感。
9. AI 短剧适配评分：评估小说章节未来是否适合改编成 AI 短剧剧本和 AI 视频。
10. 本地存储：所有数据保存到 SQLite。
11. 导出：支持导出项目 Markdown / JSON。
12. AI 调用记录：记录每次模型调用、输入、输出、状态和耗时。

v0.1 不做：

```txt
登录
云同步
多人协作
支付系统
完整小说转短剧剧本
完整分镜生成
完整镜头 Prompt 生成
AI 视频平台接入
复杂 RAG
模型微调
Python 后端
真人拍摄制片表
真人拍摄成本分析
```

---

## 4. 技术栈

使用 TypeScript。

```txt
桌面端：Electron
前端：React + Vite + TypeScript
UI：Tailwind CSS + shadcn/ui
状态管理：Zustand
数据库：SQLite
ORM：Drizzle ORM
Schema 校验：Zod
编辑器：TipTap 或 Markdown 编辑器
AI 工作流：LangGraph.js
模型调用：OpenAI-compatible API
打包：electron-builder
包管理：pnpm workspace
```

推荐依赖：

```txt
@langchain/langgraph
@langchain/core
zod
drizzle-orm
better-sqlite3
zustand
electron
electron-builder
vite
react
tailwindcss
shadcn/ui
```

LangGraph.js 工作流运行在 Electron Main Process 或独立 Node 层，不要直接写进 React UI 组件。

---

## 5. 项目结构

```txt
ai-drama-novel-studio/
  apps/
    desktop/
      electron/
        main.ts
        preload.ts
        ipc/
          project.ipc.ts
          ai.ipc.ts
          model.ipc.ts
      renderer/
        src/
          app/
          pages/
          components/
          components/ui/
          stores/
          styles/
          lib/
          main.tsx
          App.tsx

  packages/
    core/
      src/
        types/
        schemas/
        constants/

    db/
      src/
        client.ts
        schema.ts
        repositories/

    ai/
      src/
        providers/
        graphs/
        nodes/
        prompts/
        context/
        parsers/
        evaluators/

    export/
      src/
        markdown/
        json/

  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

---

## 6. 页面设计

### 6.1 项目列表页

功能：

* 查看所有项目
* 创建项目
* 删除项目
* 打开项目
* 进入模型设置

### 6.2 创建项目页

字段：

```txt
作品名称
短剧类型
目标受众
目标字数
目标 AI 短剧集数
一句话卖点
情绪主轴
核心爽点
故事简介
小说风格要求
视觉风格方向
```

短剧类型预设：

```txt
女频复仇
真假千金
重生逆袭
先婚后爱
霸总追妻
豪门恩怨
赘婿打脸
战神归来
玄学直播
古装权谋
悬疑反转
甜宠爽文
```

视觉风格方向预设：

```txt
现代都市短剧
豪门精致感
古风国风
悬疑冷色调
甜宠明亮风
暗黑复仇风
漫画感
电影感
```

### 6.3 项目工作台

三栏布局：

```txt
左侧：项目导航
中间：主要编辑区
右侧：AI 助手 / 当前信息 / 评分结果
```

左侧导航：

```txt
项目概览
人物卡
大纲
章节
AI短剧评分
AI调用记录
```

### 6.4 章节编辑页

功能：

* 章节列表
* 新建章节
* 编辑标题
* 编辑章节大纲
* 编辑正文
* 自动保存
* AI 生成正文
* AI 续写 / 改写 / 润色 / 扩写
* AI 增强冲突 / 增强爽点 / 增强 AI 短剧感
* AI 短剧适配评分

---

## 7. shadcn/ui 要求

使用 Tailwind CSS + shadcn/ui。

优先使用组件：

```txt
Button
Input
Textarea
Card
Dialog
Sheet
Tabs
DropdownMenu
Form
Select
Badge
ScrollArea
Separator
Sonner
```

整体风格：

```txt
简洁
专业
偏创作工具
不要像聊天机器人
突出正文编辑区域
默认浅色主题
```

---

## 8. 核心数据模型

### Project

```ts
export interface Project {
  id: string
  title: string
  shortDramaType: string
  targetAudience?: string
  targetWordCount?: number
  targetEpisodeCount?: number

  coreHook?: string
  emotionalCore?: string
  coreSellingPoint?: string
  synopsis?: string
  styleGuide?: string

  visualStyleDirection?: string

  createdAt: string
  updatedAt: string
}
```

### Character

```ts
export interface Character {
  id: string
  projectId: string

  name: string
  role: string
  identity?: string
  personality?: string
  desire?: string
  secret?: string
  weakness?: string
  arc?: string
  relationshipToProtagonist?: string
  conflictTarget?: string
  emotionalFunction?: string
  shortDramaFunction?: string

  visualDescription?: string
  appearancePrompt?: string
  negativePrompt?: string

  notes?: string
  createdAt: string
  updatedAt: string
}
```

### Outline

```ts
export interface Outline {
  id: string
  projectId: string
  type: 'book' | 'chapter'
  title: string
  content: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}
```

### Chapter

```ts
export interface Chapter {
  id: string
  projectId: string
  title: string
  orderIndex: number

  summary?: string
  outline?: string
  content: string

  mainConflict?: string
  hook?: string
  highlight?: string
  reversal?: string
  cliffhanger?: string

  shortDramaNote?: string
  aiVideoNote?: string

  createdAt: string
  updatedAt: string
}
```

### Evaluation

```ts
export interface Evaluation {
  id: string
  projectId: string
  chapterId?: string

  totalScore: number
  hookScore: number
  conflictScore: number
  reversalScore: number
  emotionScore: number
  visualizationScore: number
  aiVideoFeasibilityScore: number
  characterConsistencyScore: number
  shotClarityScore: number
  cliffhangerScore: number
  adaptationDifficultyScore: number

  issues: string[]
  suggestions: string[]
  rawResult?: string
  createdAt: string
}
```

### AiRun

```ts
export interface AiRun {
  id: string
  projectId?: string
  chapterId?: string

  graphName: string
  nodeName?: string
  type: string

  provider: string
  model: string

  input: string
  output: string
  status: 'success' | 'failed'
  errorMessage?: string
  tokenUsage?: number
  latencyMs?: number

  createdAt: string
}
```

---

## 9. 数据库表

使用 SQLite + Drizzle ORM。

v0.1 需要表：

```txt
projects
characters
outlines
chapters
evaluations
ai_runs
model_configs
```

`model_configs` 字段：

```txt
id
name
provider
base_url
api_key
model
is_default
created_at
updated_at
```

API Key 先本地保存即可。

---

## 10. AI Provider 接口

实现统一模型接口。

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatInput {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

export interface ChatOutput {
  content: string
  raw?: unknown
  tokenUsage?: number
}

export interface LLMProvider {
  chat(input: ChatInput): Promise<ChatOutput>
  stream?(input: ChatInput): AsyncIterable<string>
}
```

实现：

```txt
OpenAICompatibleProvider
```

支持用户配置：

```txt
baseUrl
apiKey
model
```

---

## 11. LangGraph.js 设计

v0.1 必须使用 LangGraph.js 管理 AI 工作流。

调用路径：

```txt
React UI
  ↓ IPC
Electron Main Process
  ↓
AI Service
  ↓
LangGraph.js Graph
  ↓
LLM Provider
  ↓
SQLite 记录 ai_runs
```

### 11.1 Graph State

定义统一的 `NovelGraphState`：

```ts
export interface NovelGraphState {
  projectId?: string
  chapterId?: string

  taskType:
    | 'generate_project'
    | 'generate_characters'
    | 'generate_book_outline'
    | 'generate_chapter_outline'
    | 'generate_chapter'
    | 'continue_chapter'
    | 'rewrite_chapter'
    | 'polish_chapter'
    | 'expand_chapter'
    | 'enhance_conflict'
    | 'enhance_highlight'
    | 'enhance_ai_drama_feel'
    | 'evaluate_ai_drama_fit'

  userInstruction?: string

  project?: Project
  characters?: Character[]
  outlines?: Outline[]
  chapters?: Chapter[]
  currentChapter?: Chapter

  contextText?: string
  promptText?: string
  rawOutput?: string
  parsedOutput?: unknown
  evaluation?: Evaluation

  error?: string
}
```

### 11.2 Graph 节点

至少实现以下节点：

```txt
loadProjectContextNode
buildPromptNode
callModelNode
parseOutputNode
validateOutputNode
saveResultNode
saveAiRunNode
```

节点职责：

* `loadProjectContextNode`：从 SQLite 读取项目、人物、大纲、章节。
* `buildPromptNode`：根据 taskType 构建 prompt。
* `callModelNode`：调用 OpenAI-compatible 模型。
* `parseOutputNode`：解析模型输出。
* `validateOutputNode`：使用 Zod 校验结构化输出。
* `saveResultNode`：将生成结果保存到对应表。
* `saveAiRunNode`：记录 AI 调用日志。

### 11.3 Graph 路由

根据 `taskType` 路由不同输出处理逻辑：

```txt
generate_project -> 保存 Project 草稿字段
generate_characters -> 保存 Character[]
generate_book_outline -> 保存 Outline
generate_chapter_outline -> 保存 Outline[]
generate_chapter -> 保存 Chapter.content
continue_chapter -> 追加 Chapter.content
rewrite_chapter -> 返回改写内容
polish_chapter -> 返回润色内容
expand_chapter -> 返回扩写内容
enhance_conflict -> 返回增强冲突版本
enhance_highlight -> 返回增强爽点版本
enhance_ai_drama_feel -> 返回更适合 AI 短剧改编的版本
evaluate_ai_drama_fit -> 保存 Evaluation
```

### 11.4 Graph 文件建议

```txt
packages/ai/src/graphs/novel-workflow.graph.ts
packages/ai/src/nodes/load-project-context.node.ts
packages/ai/src/nodes/build-prompt.node.ts
packages/ai/src/nodes/call-model.node.ts
packages/ai/src/nodes/parse-output.node.ts
packages/ai/src/nodes/validate-output.node.ts
packages/ai/src/nodes/save-result.node.ts
packages/ai/src/nodes/save-ai-run.node.ts
```

---

## 12. AI 工作流

v0.1 用 LangGraph.js 实现这些 workflow。

### 12.1 生成项目设定

输入：

```txt
短剧类型
目标受众
用户的一句话想法
视觉风格方向
```

输出 JSON：

```json
{
  "title": "",
  "coreHook": "",
  "emotionalCore": "",
  "coreSellingPoint": "",
  "synopsis": "",
  "styleGuide": "",
  "visualStyleDirection": "",
  "targetEpisodeCount": 60
}
```

### 12.2 生成人物卡

根据项目设定生成 3-6 个主要人物。

人物输出必须包含：

```txt
姓名
角色定位
身份
欲望
秘密
冲突对象
情绪功能
短剧功能
视觉描述
角色外观 Prompt
负面 Prompt
```

### 12.3 生成全书大纲

根据项目设定和人物卡生成全书大纲。

输出 Markdown。

### 12.4 生成章节大纲

根据全书大纲生成若干章节大纲。

输出 JSON 数组。

每章大纲包含：

```txt
标题
本章目标
核心冲突
爽点
反转
结尾钩子
AI短剧改编备注
关键画面
```

### 12.5 生成章节正文

根据项目设定、人物卡、全书大纲、章节大纲生成正文。

要求：

```txt
中文
网文感
强冲突
强情绪
有对白
有画面感
避免大段空泛心理描写
结尾有钩子或悬念
适合未来改编为 AI 短剧剧本和 AI 视频
```

### 12.6 章节辅助

支持：

```txt
续写
改写
润色
扩写
增强冲突
增强爽点
增强 AI 短剧感
生成章节摘要
```

### 12.7 AI 短剧适配评分

输出严格 JSON：

```json
{
  "totalScore": 0,
  "hookScore": 0,
  "conflictScore": 0,
  "reversalScore": 0,
  "emotionScore": 0,
  "visualizationScore": 0,
  "aiVideoFeasibilityScore": 0,
  "characterConsistencyScore": 0,
  "shotClarityScore": 0,
  "cliffhangerScore": 0,
  "adaptationDifficultyScore": 0,
  "issues": [],
  "suggestions": []
}
```

评分维度：

```txt
hookScore：开篇是否抓人
conflictScore：冲突是否明确
reversalScore：是否有反转或信息差
emotionScore：是否有强情绪
visualizationScore：是否容易形成画面
aiVideoFeasibilityScore：是否适合 AI 视频生成
characterConsistencyScore：是否有利于角色视觉一致性
shotClarityScore：是否容易拆成清晰镜头
cliffhangerScore：结尾是否有追看欲
adaptationDifficultyScore：是否容易改编成 AI 短剧
```

---

## 13. Prompt 管理

Prompt 放在：

```txt
packages/ai/src/prompts/zh-CN/
```

建议目录：

```txt
project/generate-project.md
character/generate-character.md
outline/generate-book-outline.md
outline/generate-chapter-outline.md
chapter/generate-chapter.md
chapter/continue-chapter.md
chapter/rewrite-chapter.md
chapter/polish-chapter.md
chapter/expand-chapter.md
chapter/enhance-conflict.md
chapter/enhance-highlight.md
chapter/enhance-ai-drama-feel.md
evaluation/evaluate-ai-drama-fit.md
```

Prompt 要求：

1. 使用中文。
2. 明确服务故事母本创作及其 AI 短剧/漫剧改编潜力。
3. 不能把写小说降级成 Prompt 生成。
4. JSON 输出场景只输出 JSON，不要 Markdown。
5. Prompt 和业务代码分离。
6. 每个 prompt 顶部写版本号。
7. 每次 AI 调用记录到 `ai_runs`。
8. 不要出现“真人拍摄成本”“剧组制片”“演员调度”等真人拍摄导向内容。

---

## 14. 上下文构建

实现 `ContextBuilder`。

生成章节正文时，拼接：

```txt
项目设定
短剧类型
目标集数
核心卖点
情绪主轴
视觉风格方向
主要人物
人物视觉描述
全书大纲
当前章节大纲
上一章摘要
最近 3 章摘要
当前章节已有正文
```

不要把所有历史正文都塞给模型。

建议文件：

```txt
packages/ai/src/context/context-builder.ts
```

---

## 15. Zod 校验

所有结构化 AI 输出必须用 Zod 校验。

至少实现：

```txt
GenerateProjectResultSchema
GenerateCharactersResultSchema
GenerateChapterOutlinesResultSchema
EvaluationResultSchema
```

如果 JSON 解析或 Zod 校验失败，允许自动进行一次修复重试。

---

## 16. 导出功能

v0.1 支持：

```txt
导出项目 JSON
导出项目 Markdown
导出单章 Markdown
```

暂不做 DOCX / XLSX。

---

## 17. 开发顺序

按这个顺序开发：

1. 初始化 pnpm monorepo。
2. 初始化 Electron + React + Vite。
3. 配置 Tailwind CSS + shadcn/ui。
4. 集成 SQLite + Drizzle ORM。
5. 实现数据库 schema 和 repository。
6. 实现项目列表、创建项目、打开项目。
7. 实现工作台三栏布局。
8. 实现人物 CRUD。
9. 实现大纲 CRUD。
10. 实现章节 CRUD 和正文编辑。
11. 实现模型配置。
12. 实现 OpenAI-compatible provider。
13. 接入 LangGraph.js。
14. 实现 NovelGraphState。
15. 实现 LangGraph 基础节点。
16. 实现 AI 生成项目设定。
17. 实现 AI 生成人物。
18. 实现 AI 生成全书大纲。
19. 实现 AI 生成章节大纲。
20. 实现 AI 生成章节正文。
21. 实现 AI 续写、改写、润色、扩写。
22. 实现 AI 短剧适配评分。
23. 实现 AI 调用记录页面。
24. 实现 Markdown / JSON 导出。
25. 配置 electron-builder 打包。

---

## 18. 代码要求

1. 全部使用 TypeScript。
2. UI 组件优先使用 shadcn/ui。
3. 数据结构使用 Zod 校验。
4. AI JSON 输出必须校验。
5. AI 工作流必须通过 LangGraph.js 执行。
6. React 组件不得直接调用模型。
7. Repository 层不得写进 React 组件。
8. AI Provider 不要写进 React 组件。
9. Prompt 模板独立存放。
10. 所有 AI 调用必须记录。
11. 不要过早设计插件系统。
12. v0.1 优先保证可运行、可写作、可保存、可调用 AI。
13. 所有 AI 逻辑必须围绕“故事/IP 权威资产 + 小说创作 + 短剧/漫剧改编潜力”，而不是只生成视频 Prompt。

---

## 19. v0.1 验收标准

完成后必须能演示：

1. 启动桌面应用。
2. 配置 OpenAI-compatible 模型。
3. 创建“女频重生复仇”AI 短剧小说项目。
4. AI 通过 LangGraph.js 生成项目设定。
5. AI 通过 LangGraph.js 生成主要人物，并包含人物视觉描述。
6. AI 通过 LangGraph.js 生成全书大纲。
7. AI 通过 LangGraph.js 生成章节大纲。
8. 创建第 1 章。
9. AI 通过 LangGraph.js 根据章节大纲生成正文。
10. AI 通过 LangGraph.js 对章节进行 AI 短剧适配评分。
11. 根据建议润色或增强 AI 短剧感。
12. 所有数据保存到 SQLite。
13. 所有 AI 调用记录保存到 `ai_runs`。
14. 关闭应用后重新打开，数据仍然存在。
15. 导出项目 Markdown / JSON。

---

## 20. v0.1 历史优先任务

先完成最小可运行闭环：

```txt
Electron + React + shadcn/ui + SQLite 项目能启动
可以创建项目
可以创建章节
可以编辑章节正文
可以配置 OpenAI-compatible 模型
可以通过 LangGraph.js 调用模型生成章节正文
可以保存到本地数据库
可以记录 AI 调用日志
```

完成这个闭环后，再补人物、大纲、AI 短剧评分和导出。
