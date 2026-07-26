# UX 与功能完整度全量优化执行计划

依据 [LOOPRULE.md](./LOOPRULE.md) 编写，用于把 2026-07-25 对 `dramaip-desktop`
的功能设计与交互设计审计结论（19 项问题）拆成可逐轮执行、审查、验证、提交、回滚
和远端闭环的 loop。

本计划承接历史 LM2～LM5 已交付的能力，不重做已有功能，只优化信息架构、交互体验、
性能、健壮性、无障碍和一致性。

## 0. 目标与范围

### 0.1 总体目标

消除以下 19 项审计问题，按依赖关系分成 8 个阶段（Phase 0～7），每个阶段含若干
loop。每个 loop 完成后必须单独提交、验证、合并和推送，禁止批量推进。

### 0.2 问题清单与 loop 映射

| # | 问题 | 优先级 | 所属 Phase |
|---|------|--------|-----------|
| 13 | 每打字触发 14+ IPC（chapterWorkflowKey） | P0 | Phase 1 |
| 8 | 章节级 section 切章不刷新数据 | P0 | Phase 1 |
| 1 | 工作台导航过载（26 section + 5 分组） | P0 | Phase 2 |
| 2 | 章节模式吞掉项目导航 | P0 | Phase 2 |
| 3 | 导航菜单复制 3 遍 | P0 | Phase 2 |
| 4 | GlobalRail 全局不一致 | P0 | Phase 2 |
| 5 | AiContextPreviewDialog 4 份实例 + contextControls 不共享 | P0 | Phase 3 |
| 15 | WorkspacePage 28+ useState | P0 | Phase 3 |
| 9 | AI 失败 toast 无重试按钮 | P1 | Phase 4 |
| 10 | 无网络在线/离线检测 | P1 | Phase 4 |
| 11 | VideoGenerationPage 多处 IPC 无 catch | P1 | Phase 4 |
| 12 | 流式生成异常时编辑器卡只读 | P1 | Phase 4 |
| 7 | 自动保存恢复草稿无声覆盖 | P1 | Phase 5 |
| 6 | 项目卡片双 CTA 困惑 | P1 | Phase 5 |
| 16 | 视频平台 4/9 虚标 | P1 | Phase 5 |
| 14 | 列表无虚拟化 | P1 | Phase 6 |
| 17 | 列表卡片 div 不可键盘聚焦 | P2 | Phase 7 |
| 18 | Dialog 焦点不还原 | P2 | Phase 7 |
| 19 | Section header 样式重复未抽组件 | P2 | Phase 7 |

### 0.3 依赖关系

```
Phase 0（基础设施：AppShell + RootLayout）
  ↓ Phase 2 依赖 RootLayout；Phase 3 依赖共享 store 基建
Phase 1（性能：chapterWorkflowKey + 按章加载）        ← 独立，可与 Phase 0 并行
  ↓ Phase 6 依赖 Phase 3 的 store 拆分
Phase 2（导航架构）
Phase 3（状态收敛：contextControls + workflow store）
Phase 4（健壮性：错误处理/离线/catch/流式兜底）
Phase 5（交互与数据安全：草稿/CTA/视频虚标）
Phase 6（虚拟化）
Phase 7（无障碍与组件一致性）
```

Phase 0 和 Phase 1 无互相依赖，可并行或任选先做。Phase 2～7 有顺序依赖。

---

## Phase 0：全局布局基础设施

目标：引入 React Router layout route + RootLayout，让 GlobalRail 在所有页面可用，
统一 header 结构。这是 Phase 2 导航重构的前置依赖。

### Loop 0-A：抽取 RootLayout + GlobalRail 全局化

**问题**：#4 GlobalRail 只在 WorkspaceShell/ProductionWorkspaceShell 内硬编码
（`WorkspaceShell.tsx:151`、`ProductionWorkspaceShell.tsx:60`），ProjectListPage /
SettingsPage / CreateProjectPage 三页完全没有 GlobalRail，主题切换按钮在这些页面
不存在。

**范围**：
1. 新建 `components/shell/RootLayout.tsx`：
   - 渲染 `<GlobalRail />`（从 WorkspaceShell 移出）
   - 渲染 `<Outlet />`（React Router 子路由）
   - 包含 TaskDock（从 App.tsx 顶层移入）
2. `App.tsx` 路由改造：用嵌套 Route 包裹所有页面路由：
   ```tsx
   <Route element={<RootLayout />}>
     <Route path="/" element={<ProjectListPage />} />
     <Route path="/settings/*" element={<SettingsPage />} />
     ...
   </Route>
   ```
3. `WorkspaceShell.tsx` 和 `ProductionWorkspaceShell.tsx` 移除内部 `<GlobalRail />`
4. GlobalRail 的激活态判断修正（`WorkspaceShell.tsx:79`）：`/settings/tasks` 也应
   高亮「设置」而非不高亮

**验收**：
- 项目列表页、设置页、创建页左侧出现 GlobalRail
- 主题切换在所有页面可用
- 工作区和改编页布局不变（GlobalRail 不重复渲染）
- `tsc --noEmit` 通过；手动验证 5 类页面

---

## Phase 1：性能——消除打字触发全量 IPC

目标：解决 P0 性能问题——用户在编辑器每打一个字都触发 14+ IPC 调用。

### Loop 1-A：chapterWorkflowKey 解耦正文内容

**问题**：#13 `WorkspacePage.tsx:159-171` 的 `chapterWorkflowKey` 把所有章节的
`content`（完整正文）纳入 `JSON.stringify`，每次按键都重建一个全书大小的字符串，
触发 `loadWorkflowSnapshot` 重跑全部 9 个项目级 IPC + adaptation 扇出。

**范围**：
1. 把 `chapterWorkflowKey` 拆成两个 key：
   - `chapterMetaKey`：只含 `id/title/summary/outline/mainConflict/hook/highlight/
     reversal/cliffhanger`（不含 content）——用于判断质量真值是否过期
   - 正文变更不再触发 workflow snapshot 重算
2. `loadWorkflowSnapshot` 的 effect 依赖从 `[project, chapterWorkflowKey, dataVersion,
   loadWorkflowSnapshot, requestedAdaptationId]` 改为 `[project, chapterMetaKey,
   dataVersion, loadWorkflowSnapshot, requestedAdaptationId]`
3. 正文的持久化（`onContentChange` → `ipc.chapter.updateContent`）保持不变；本地
   `setChapters` 仍更新编辑器可见内容，但不再触发 workflow 重算
4. 如果质量真值依赖正文字数/内容摘要，改为在显式保存（flush）或 AI 任务完成后
   才刷新（用 `dataVersion` 递增触发）

**验收**：
- 连续打字时不再出现 IPC 风暴
- AI 生成、采用、章节保存后 workflow snapshot 仍正确刷新
- 质量闸门「过期」判断仍准确

### Loop 1-B：章节级 Section 改为按章加载

**问题**：#8 MemorySection/HighlightSection/BeatSection/ForeshadowingSection/
TimelineSection/CharacterStateSection/EvaluationSection/AiVideoFeasibilitySection
的 `reload()` 只依赖 `projectId`，切换章节不刷新，但 UI 标题暗示是当前章的。

**范围**：
1. 后端补齐 ByChapter IPC（部分仓库函数已存在但未暴露）：
   - `chapterMemory:getByChapter`（repo 已有 `getChapterMemoryByChapter`）
   - `highlight:getByChapter`（repo 已有 `getHighlightByChapter`）
   - `evaluation:listByChapter`（repo 已有 `listEvaluationsByChapter`）
   - `feasibility:getByChapter`（repo 已有 `getFeasibilityByChapter`）
   - `storyEvent:listByChapter`（schema 有 chapterId 列，新增 repo 函数）
   - `foreshadowing:listByChapter`（schema 有 chapterId 列，新增 repo 函数）
   - `characterState:listByChapter`（新增 repo 函数）
   - `beat.listByChapter` 已暴露但 Section 未用，改为调用它
2. 各 Section 组件的 `reload` 依赖加入 `chapter?.id`，IPC 改用 ByChapter 变体
3. 无 chapterId 时（未选章）显示「请先选择章节」空状态

**验收**：
- 切换章节时各 Section 列表正确刷新为当前章数据
- 未选章时显示明确空状态
- `tsc --noEmit` + `pnpm test:db` 通过

---

## Phase 2：导航信息架构重构

目标：解决 P0 认知负担问题——26 个 section、3 套重复导航实现、章节模式吞掉项目
导航。依赖 Phase 0 的 RootLayout。

### Loop 2-A：抽取统一导航组件 + 收敛分组

**问题**：#1 导航过载；#3 `WORKSPACE_NAV_GROUPS.map` 在 WorkspacePage 复制了 3 次
（`989-1003`、`1032-1046`、`1063-1093`）。

**范围**：
1. 新建 `components/shell/WorkspaceNav.tsx`：
   - 接收 `variant: 'list' | 'dropdown'`、`activeSection`、`onSelect(key)`
   - 内部统一处理 `WORKSPACE_NAV_GROUPS` 的遍历和 `writing-room` 跳转特例
   - 消除三处重复 map
2. 重新组织分组，减少「创作」组的混杂：
   - 创作核心：chapters, overview, chat
   - 设定与素材：characters, outline, story-planning, inspiration, project-skills,
     agent-schemes
   - 记忆一致性：memory, character-state, visual-profile, visual-setting,
     timeline, foreshadowing, consistency
   - 诊断：quality-gates, evaluation, ai-dashboard, creative-diagnosis, beats,
     highlights
   - 改编准备：ai-video, writing-room
   - 记录：ai-runs
3. WorkspacePage 三套导航实现替换为 `<WorkspaceNav>` 的不同 variant

**验收**：
- 导航行为不变（跳转、激活态、writing-room 特例）
- 三处重复 map 消除为单一组件
- 分组更合理，「创作核心」不再混杂配置类功能

### Loop 2-B：章节模式保留项目导航入口

**问题**：#2 `WorkspacePage.tsx:970` 章节模式（`section === 'chapters' && mode ===
'full'`）时整个上下文侧栏被替换为章节树，用户看不到其他 section 入口。

**范围**：
1. 章节模式下，上下文侧栏改为**上下分区**：
   - 上区：章节树（保持现有 ChapterTree）
   - 下区：紧凑版分组导航（`WorkspaceNav variant="compact"`，可折叠）
   - 或顶部固定一个「返回项目导航」的显式入口
2. 章节树区域和导航区域用可拖拽分割或折叠面板分开
3. compact 模式（窄屏）保持现有的图标菜单兜底

**验收**：
- 章节编辑时左侧仍能看到并切换到其他 section
- 章节树功能不退化（搜索、重排、批量）
- 窄屏模式不受影响

---

## Phase 3：状态收敛与上下文共享

目标：解决 P0 冗余——contextControls 分散在 3 处不共享；WorkspacePage 28+ useState。
依赖 Phase 0 的 store 基建。

### Loop 3-A：contextControls 统一到共享 store

**问题**：#5 `contextControls` 在 WorkspacePage 顶层（`:147`，2 个 dialog 共享）和
AiAssistantPanel 内部（`:60`，独立一份）各自维护，用户在面板调的固定/排除对命令
面板不可见，反之亦然。

**范围**：
1. 新建 `stores/useAiContextStore.ts`（遵循现有 useModelStore/useProjectsStore 模式）：
   - `contextControls: AiContextControls`
   - `setControlMode(key, targetId, mode)`
   - `resetControls()`
2. WorkspacePage 顶层和 AiAssistantPanel 都改为读写这个 store
3. AiAssistantPanel 新增 props `contextControls` / `onContextControlChange`（或直接
   用 store），移除内部 `useState<AiContextControls>({})`
4. 3 个 AiContextPreviewDialog 实例的 `onControlModeChange` 都指向同一个 store setter

**验收**：
- 在任一入口调整的上下文固定/排除，对所有 AI 入口立即可见
- 3 个 dialog 行为一致
- 无新增重渲染问题（zustand selector 精确订阅）

### Loop 3-B：拆分 WorkspacePage workflow 数据到 store

**问题**：#15 WorkspacePage 28+ useState，任意 setState 触发整个 JSX 树重渲染。

**范围**：
1. 新建 `stores/useWorkflowSnapshotStore.ts`：
   - 持有 `characters / outlines / chapterMemories / qualityReports / adaptations /
     visualProfiles / caseStudies / storyArcs / projectSkills / adaptationReadiness`
   - `load(projectId, chapters, adaptationId)` action（迁移自 loadWorkflowSnapshot）
   - `invalidate()` action（递增内部版本号，替代 dataVersion）
2. WorkspacePage 保留 UI 交互态（section / selectedId / preview / running 等），
   数据态迁移到 store
3. 各 Section 组件改为从 store 读取所需数据（用 selector 精确订阅）

**验收**：
- WorkspacePage 内交互态变化不触发数据态组件重渲染
- 数据加载行为不变
- `tsc --noEmit` 通过

---

## Phase 4：错误处理与健壮性

目标：解决 P1 错误处理问题。Phase 4 各 loop 互相独立。

### Loop 4-A：AI 失败 toast 加重试按钮

**问题**：#9 全应用 194 处 toast.error 无重试按钮。

**范围**：
1. 新建 `lib/toast.ts`，封装 `toastAiError(message, retryAction?)`：
   - 有 retryAction 时显示带「重试」按钮的 toast
   - 无 retryAction 时退化为普通 toast.error
2. 重点改造章节级 Section（HighlightSection/BeatSection/MemorySection/
   ConsistencySection/ForeshadowingSection/TimelineSection 等）的 AI 失败分支
3. AiAssistantPanel.runActionNow 的 catch 分支加重试
4. 后端错误码（如 `cloud_quota_insufficient`）映射为中文友好提示

**验收**：
- AI 失败时出现「重试」按钮，点击重新执行
- 配额不足等已知错误显示中文而非原始 code

### Loop 4-B：网络在线/离线检测

**问题**：#10 无在线检测，断网后用户等 95 秒超时。

**范围**：
1. 在 RootLayout（Phase 0）加 `online/offline` 事件监听
2. 断网时顶部显示 banner「网络已断开，AI 任务可能失败」
3. 断网时禁用 AI 生成按钮（视觉灰化 + title 提示）
4. 恢复时自动消失 banner

**验收**：
- 断网后 banner 出现，AI 按钮灰化
- 恢复后 banner 消失

### Loop 4-C：补全 IPC catch + 流式只读兜底

**问题**：#11 VideoGenerationPage 6 处 IPC 无 catch；#12 流式异常时编辑器可能卡只读。

**范围**：
1. VideoGenerationPage 所有 `ipc.ai.run` / `ipc.ai.runStream` 调用补 try/catch，
   catch 中关闭 loading toast + 显示错误
2. ChapterEditor 的流式通道加超时兜底：`beginStreaming` 时启动一个 5 分钟超时
   timer，到期强制 `endStreaming`，toast 提示「生成超时，已恢复编辑」
3. WorkspacePage 的 `handleStreamContent` 加防御：若编辑器句柄为空，忽略而非崩溃

**验收**：
- 模拟 IPC 异常不导致 loading toast 卡死
- 流式中断后编辑器 5 分钟内自动恢复可编辑
- `tsc --noEmit` 通过

---

## Phase 5：交互与数据安全

目标：解决 P1 交互痛点。Phase 5 各 loop 互相独立。

### Loop 5-A：自动保存草稿恢复加确认

**问题**：#7 `useAutosaveDraft` 的 recovered 状态无声覆盖新加载内容，无 diff 预览。

**范围**：
1. ChapterEditor 的 recovered 状态改为弹出一个轻量确认 Dialog（而非小字按钮）：
   - 显示「检测到未保存的草稿，是否恢复？」
   - 提供草稿预览（只读 textarea 或 diff 摘要）
   - 「恢复草稿」/「丢弃草稿」二选一
2. 保存按钮在 recovered 态禁用或加确认，防止误写过时草稿
3. `writeDraftRecovery` 失败时（localStorage 满/隐私模式）设置全局标志，TaskDock
   或 banner 提醒

**验收**：
- 换章/刷新后有恢复草稿时不静默覆盖，弹确认
- localStorage 不可用时有提示

### Loop 5-B：项目卡片 CTA 简化

**问题**：#6 ProjectCard 底部「进入工作台」+ 动态「下一步」双 CTA 语义不清。

**范围**：
1. 主按钮统一为「进入工作台」（进 overview），文案稳定
2. 「下一步」信息保留在卡片中部的「当前下一步」区块（已有），不作为按钮
3. 或：主按钮文案用动态下一步，但加 tooltip 说明「进入创作工作台」
4. 减少单卡片可点区域密度

**验收**：
- 卡片只有 1 个主 CTA + 右上角置顶/删除
- 用户不再困惑两个按钮的区别

### Loop 5-C：视频平台虚标治理

**问题**：#16 jimeng/kling/runway/pika 在 UI 可选但提交即报错。

**范围**：
1. UI 配置项中 4 个未实现平台标记为「即将支持」并禁用选择
2. 或从 `VIDEO_PROVIDER_KIND_LABELS`（`constants:313-323`）移除这 4 项
3. 已配置了这 4 个 provider 的存量数据，显示迁移提示
4. `notImplementedRealPlatformAdapter` 的错误信息改为更友好的中文提示

**验收**：
- 用户无法选择未实现的平台
- 存量配置有迁移引导

---

## Phase 6：列表虚拟化

目标：解决 P1 大列表卡顿。依赖 Phase 3 的 store 拆分（数据来源已收敛）。

### Loop 6-A：引入虚拟化列表

**问题**：#14 项目列表/AI 记录表/灵感卡网格直接 `.map` 渲染，无虚拟化。

**范围**：
1. 引入 `@tanstack/react-virtual`（轻量、无 UI 绑定）
2. ProjectListPage 项目卡片网格改用虚拟化（保留现有卡片样式）
3. WorkspacePage AI 运行记录表（100 行）改用虚拟化
4. InspirationDeskSection 卡片网格改用虚拟化
5. ChapterTree 已有手写虚拟滚动，评估是否迁移到统一方案（可选）

**验收**：
- 100+ 项目/记录时滚动流畅
- `tsc --noEmit` 通过

---

## Phase 7：无障碍与组件一致性

目标：解决 P2 工程质量问题。Phase 7 各 loop 互相独立。

### Loop 7-A：列表卡片键盘可达 + Dialog 焦点还原

**问题**：#17 列表卡片用 `<div>` 不可键盘聚焦；#18 Dialog 关闭后焦点不还原。

**范围**：
1. HighlightSection/BeatSection/ForeshadowingSection 的列表卡片：外层 `<div>` 改
   `<article>` 或加 `role="listitem"`，删除按钮确保 `tabIndex` 可达
2. 受控 Dialog（`open={state !== null}`）：用 `onCloseAutoFocus` 显式还原焦点到
   触发按钮，或在关闭时聚焦列表容器
3. 全局快捷键加 `?` 弹出快捷键清单面板
4. Alt+↑↓ 切章在输入法 composing 时禁用（对齐 ⌘K 的处理）

**验收**：
- 键盘 Tab 可到达所有列表卡片的操作按钮
- Dialog 关闭后焦点回到触发器
- `?` 弹出快捷键面板

### Loop 7-B：抽取共享 UI 组件

**问题**：#19 Section header 18 处重复、空状态文案 10+ 处重复。

**范围**：
1. 新建 `components/SectionHeader.tsx`：
   - props: `title / icon? / actions? / variant?: 'sm' | 'base' | 'lg'`
   - 替换 18 处重复的 `border-b px-4 py-2 + h2` 模式
2. 新建 `components/EmptyState.tsx`：
   - props: `icon? / title / description / action?`
   - 替换各 Section 的 `<p className="text-sm text-muted-foreground">还没有…</p>`
3. 统一 Suspense fallback 为 `<PageLoader />` 组件

**验收**：
- 18 处 header 统一为 SectionHeader
- 空状态统一为 EmptyState
- 视觉无回退

---

## 执行约束

1. **每个 loop 独立分支**：`loop/ux-{phase}-{label}`，完成后合并回 main 并推送。
2. **逐 loop 推进**：完成一个 loop 的执行→验证→提交→合并→推送→清理后，才开始下一个。
3. **验证命令**：每个 loop 完成后至少运行 `tsc --noEmit -p apps/desktop/tsconfig.web.json`；
   涉及 DB 的 loop 加跑 `pnpm test:db`；涉及主流程的加跑 `pnpm test:unit`。
4. **不破坏现有功能**：每个 loop 的 diff 应聚焦单一目标，避免夹带无关改动。
5. **回滚预案**：每个 loop 若引入回归，立即 revert 该 loop 的合并提交，记录阻塞原因。
