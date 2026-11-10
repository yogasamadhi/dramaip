/** Copy of the independent adaptation strategy tool. */
export const strategyZh = {
  "strategy.label": "独立改编策略工作台",
  "strategy.navigation": "指定独立策略链接含空白或重复身份；未改用最近候选。",
  "strategy.basis.title": "确认独立策略基准",
  "strategy.basis.description":
    "继承明确采用的诊断、作者意图与实际阅读表达，不扩张局部范围。模型提出 2–3 个不同动作的策略供比较，不自动选方向；制作风险不是报价，结构检查不是语义质量或权利核验。",
  "strategy.basis.diagnosis": "当前可用诊断：{diagnosis} · ",
  "strategy.basis.diagnosis.version": "v{version}",
  "strategy.basis.diagnosis.rechecking": "v{version}（上次实际读取，正在重核）",
  "strategy.basis.diagnosis.none": "尚无来源有效的正式诊断",
  "strategy.basis.check": "核对诊断",
  "strategy.basis.confirm": "确认独立策略来源",
  "strategy.basis.required": "请先明确采用来源有效的诊断。",
  "strategy.basis.owner": "独立策略来源项目归属不符。",
  "strategy.frozen":
    "本轮冻结诊断 v{version}；来源变化、失败重试与重启不自动重绑。{next}",
  "strategy.frozen.workflow": "正在读取原工作流请求。",
  "strategy.frozen.start": "确认本身不发送模型；生成时再核对。",
  "strategy.accepted": "当前独立策略 v{version} · {option} · {state} · ",
  "strategy.accepted.current": "来源有效",
  "strategy.accepted.stale": "来源已变化",
  "strategy.accepted.next": "继续核对整季方案基准 →",
  "strategy.workflow.loading":
    "正在读取指定原策略运行；未恢复缓存 AI 草稿或重新生成。",
  "strategy.workflow.missing":
    "指定工作流不存在或归属／操作不符；不会改用最新策略。{message}",
  "strategy.result": "独立改编策略",
  "strategy.instruction":
    "从已确认诊断和实际表达提出 2–3 个保留／合并／删减／重排／重构动作有真实差异的策略，不生成季纲或正文，不默认选择。",
  "strategy.history": "独立策略历史",
  "strategy.history.item": "策略 v{version} · {status}{current}",
  "strategy.current": " · 当前正式",
  "strategy.history.owner": "策略历史项目归属不符。",
  "strategy.history.cursor": "策略历史游标重复，尚未核全。",
  "strategy.open": "打开此策略原运行（不切换最近运行）",
  "strategy.rechecking":
    "正在重核原运行／策略；以下为上次实际原快照，操作暂不可用。",
  "strategy.title": "独立策略 v{version} · {status}{current}",
  "strategy.basis":
    "冻结诊断 v{version}；{chapters} 章身份，未读目录 {omitted} 章；生成来源 {engine}。实际 usage／结算费用另以运行记录／回执为准，未知不等于零。",
  "strategy.coverage": "策略实际阅读表达",
  "strategy.stale": "来源已变化：{reasons}。保留原结果，不能覆盖当前方向。",
  "strategy.stale.separator": "；",
  "strategy.choose": "比较并明确选择一个独立策略",
  "strategy.option.choose": "选择独立策略 {title}",
  "strategy.option.adopted": " · 已正式采用",
  "strategy.action.preserve": "保留：{items}",
  "strategy.action.merge": "合并：{items}",
  "strategy.action.remove": "删减：{items}",
  "strategy.action.reorder": "重排：{items}",
  "strategy.action.restructure": "重构：{items}",
  "strategy.action.none": "未提出",
  "strategy.action.separator": "；",
  "strategy.rhythm": "节奏：{rhythm} · 诊断发现：{findings}",
  "strategy.findings.separator": "、",
  "strategy.risks": "风险：{risks} · 制作 {level}：{notes}",
  "strategy.adopt": "采用此独立策略",
  "strategy.adopt.choose": "请明确选择这个 AI 草稿中的一个策略，没有默认选项。",
  "strategy.adopt.title": "采用独立改编策略",
  "strategy.adopt.description":
    "采用一个明确选项，保留旧版本；不自动生成季纲、改写原稿或采用其他 AI 草稿。",
  "strategy.adopt.accept": "确认采用此策略",
  "strategy.discard": "放弃此策略 AI 草稿",
  "strategy.discard.title": "放弃独立策略 AI 草稿",
  "strategy.discard.description": "只放弃这个 AI 草稿，当前方向与原稿不变。",
  "strategy.discard.accept": "确认放弃此 AI 草稿",
  "strategy.cancel": "取消",
  "strategy.close": "关闭",
  "strategy.mismatch": "指定 AI 草稿归属或工作流不符，不展示其他对象。",
};

export const strategyEn: Record<keyof typeof strategyZh, string> = {
  "strategy.label": "Independent adaptation strategy workbench",
  "strategy.navigation":
    "The strategy link names a blank or repeated identity; no nearest candidate was used instead.",
  "strategy.basis.title": "Confirm the strategy basis",
  "strategy.basis.description":
    "It inherits the adopted diagnosis, the author intent and the expressions actually read, without widening a partial scope. The model proposes 2–3 strategies with different actions to compare and picks none; production risk is not a quote, and structural checks are not semantic quality or a rights check.",
  "strategy.basis.diagnosis": "Available diagnosis: {diagnosis} · ",
  "strategy.basis.diagnosis.version": "v{version}",
  "strategy.basis.diagnosis.rechecking":
    "v{version} (last actual read, checking again)",
  "strategy.basis.diagnosis.none": "no adopted diagnosis with current sources",
  "strategy.basis.check": "Check the diagnosis",
  "strategy.basis.confirm": "Confirm the strategy sources",
  "strategy.basis.required":
    "Adopt a diagnosis whose sources are current first.",
  "strategy.basis.owner": "The strategy sources belong to another project.",
  "strategy.frozen":
    "This round froze diagnosis v{version}; source changes, retries and restarts do not rebind it. {next}",
  "strategy.frozen.workflow": "Reading the original run's request.",
  "strategy.frozen.start":
    "Confirming sends nothing to a model; it is checked again when generating.",
  "strategy.accepted": "Adopted strategy v{version} · {option} · {state} · ",
  "strategy.accepted.current": "sources current",
  "strategy.accepted.stale": "sources changed",
  "strategy.accepted.next": "Go on to the season plan basis →",
  "strategy.workflow.loading":
    "Reading the chosen strategy run; no cached AI draft is restored and nothing is generated again.",
  "strategy.workflow.missing":
    "The chosen run does not exist or belongs to another project or operation; the latest strategy is not used instead. {message}",
  "strategy.result": "Independent adaptation strategy",
  "strategy.instruction":
    "From the confirmed diagnosis and the actual expressions, propose 2–3 strategies whose preserve / merge / remove / reorder / restructure actions really differ, without generating a season plan or text and without choosing one.",
  "strategy.history": "Strategy history",
  "strategy.history.item": "Strategy v{version} · {status}{current}",
  "strategy.current": " · adopted",
  "strategy.history.owner": "The strategy history belongs to another project.",
  "strategy.history.cursor":
    "The strategy history repeated a cursor and is not fully read.",
  "strategy.open": "Open this strategy's original run (not the latest)",
  "strategy.rechecking":
    "Checking the original run and strategy again; below is the last actual snapshot, and actions wait.",
  "strategy.title": "Strategy v{version} · {status}{current}",
  "strategy.basis":
    "Frozen diagnosis v{version}; {chapters} chapters, {omitted} unread in the directory; generated by {engine}. Actual usage and cost come from run records and receipts; unknown is not zero.",
  "strategy.coverage": "What the strategy actually read",
  "strategy.stale":
    "Sources changed: {reasons}. The result is kept and cannot replace the current direction.",
  "strategy.stale.separator": "; ",
  "strategy.choose": "Compare and choose one strategy",
  "strategy.option.choose": "Choose strategy {title}",
  "strategy.option.adopted": " · adopted",
  "strategy.action.preserve": "Preserve: {items}",
  "strategy.action.merge": "Merge: {items}",
  "strategy.action.remove": "Remove: {items}",
  "strategy.action.reorder": "Reorder: {items}",
  "strategy.action.restructure": "Restructure: {items}",
  "strategy.action.none": "none proposed",
  "strategy.action.separator": "; ",
  "strategy.rhythm": "Rhythm: {rhythm} · findings: {findings}",
  "strategy.findings.separator": ", ",
  "strategy.risks": "Risks: {risks} · production {level}: {notes}",
  "strategy.adopt": "Adopt this strategy",
  "strategy.adopt.choose":
    "Choose one strategy of this AI draft explicitly; there is no default.",
  "strategy.adopt.title": "Adopt the adaptation strategy",
  "strategy.adopt.description":
    "Adopts one explicit option and keeps old versions; no season plan is generated, the manuscript is not rewritten and no other AI draft is adopted.",
  "strategy.adopt.accept": "Adopt this strategy",
  "strategy.discard": "Discard this strategy AI draft",
  "strategy.discard.title": "Discard the strategy AI draft",
  "strategy.discard.description":
    "Only this AI draft is discarded; the current direction and the manuscript are unchanged.",
  "strategy.discard.accept": "Discard this AI draft",
  "strategy.cancel": "Cancel",
  "strategy.close": "Close",
  "strategy.mismatch":
    "The chosen AI draft belongs to another project or run; nothing else is shown.",
};
