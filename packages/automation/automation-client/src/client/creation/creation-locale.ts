/** Copy of the creation workbench, as the existing app words it. */
export const creationZh = {
  "progress.aria": "AI 执行实时反馈",
  "progress.ended": "本次已返回内容",
  "progress.elapsed.aria": "创作已用时间",
  "progress.elapsed": "已用 {time}",
  "progress.seconds": "{seconds} 秒",
  "progress.minutes": "{minutes} 分 {seconds} 秒",
  "progress.steps.aria": "创作步骤",
  "progress.step.prepare": "准备资料",
  "progress.step.generate": "生成 AI 草稿",
  "progress.step.check": "检查与修订",
  "progress.step.review": "等待审阅",
  "progress.stage.preparing": "准备创作资料",
  "progress.stage.generating": "生成正文与方案",
  "progress.stage.checking": "检查 AI 草稿",
  "progress.stage.revising": "修订 AI 草稿",
  "progress.stage.rechecking": "复检 AI 草稿",
  "progress.waiting.preparing": "正在整理本章、创作要求和已采用资料",
  "progress.waiting.generating": "正在等待模型返回内容",
  "progress.waiting.checking":
    "正在核对创作要求、情节与资料一致性，等待检查结果",
  "progress.waiting.revising": "正在根据检查意见修改，等待修订内容",
  "progress.waiting.rechecking": "正在检查修订结果，等待复检结论",
  "progress.returning.check": "检查结果正在返回",
  "progress.returning.content": "内容正在返回，可实时查看下方预览",
  "progress.preview.check": "实时检查反馈",
  "progress.preview.content": "实时内容预览",
  "progress.preview.ended": "生成片段（未采用）",
  "progress.preview.aria": "AI 实时返回内容",
  "progress.length": "已返回 {count} 字",
  "progress.after.active": "完成检查后会生成 AI 草稿，供你审阅采用。",
  "progress.after.ended": "本次未完成，已返回的片段保留供查看。",
  "progress.slow": "模型响应较慢时，等待时间会持续更新，也可以停止生成。",
  "progress.itemsError": "实时内容暂时无法读取，正在重连，任务状态会继续更新。",
  "execution.phase.generating": "生成",
  "execution.phase.checking": "检查",
  "execution.phase.revising": "局部修订",
  "execution.phase.rechecking": "复检",
  "execution.phase.unknown": "阶段未知",
  "execution.aria": "创作阶段执行回执",
  "execution.workflow": "原工作流 {workflowId} · 版本 {version} · {operation}",
  "execution.scope": "仅此工作流尝试，按原运行顺序；不是跨重试总量。",
  "execution.source": " 前次原工作流：{workflowId}，其用量未并入。",
  "execution.cost": "费用与结算未知，不把检查通过当文学质量证明。",
  "execution.none": "尚无已分配运行，不代表零用量或已经完成。",
  "execution.run": "{index}. {phase} · 原运行 {runId}",
  "execution.missing":
    "原运行尚未建立或已缺失；模型、时间和用量未知。不换成最近运行。",
  "execution.engine": "实际引擎 {engine} · 持久状态 {status}",
  "execution.model": "持久模型：{model}",
  "execution.model.invalid": "原记录无效",
  "execution.model.unrecorded": "未记录，不读当前默认模型补造",
  "execution.timing": "运行起止（含准备阶段）：{timing}",
  "execution.timing.measured": "{startedAt} → {completedAt} · {durationMs} ms",
  "execution.timing.progress":
    "{startedAt}开始；未记录终止时间，不推算最终耗时",
  "execution.timing.invalid": "原时间无效／倒置，不补零",
  "execution.timing.unrecorded": "未完整记录，耗时未知",
  "execution.panel": "全部创作阶段执行记录",
  "execution.pending": "正在核对原阶段记录…",
  "execution.read": "查看全部创作阶段执行记录",
  "execution.error": "{error} 原阶段读取失败，不使用旧缓存或换运行。",
  "context.aria": "原阶段上下文快照",
  "context.run": "原运行 {runId} · 原快照 {snapshotId}",
  "context.tokens":
    "完整提示估算 {estimated} token / 预算 {budget} token；不是实际用量。",
  "context.entries":
    "纳入 {included} 条表达，未纳入 {excluded} 条。这是表达条数，不是全书章节覆盖率；摘要、段落和作者解释不等于全文阅读。",
  "context.note":
    "原持久输入及排除理由如下；不读取最新正文或换成首次生成的上下文。未记录的裁剪不推断，纳入不证明模型已经读取或理解，字节指纹不认证历史真实性或文学质量。",
  "context.promptDigest": "提示 SHA-256 {digest}",
  "context.manifestDigest": "表达清单 SHA-256 {digest}",
  "context.entry": "{kind} {id} v{version} · {state}",
  "context.included": "已纳入",
  "context.excluded": "未纳入",
  "context.entryReason": "{field} · {reason} · 估算 {tokens} token",
  "context.entryValue": "查看此条原冻结表达",
  "context.prompt": "查看此阶段完整原提示（可能包含本地私有正文或 AI 草稿）",
  "context.panel": "阶段原上下文 {runId}",
  "context.pending": "正在读取原阶段上下文…",
  "context.read": "查看此阶段原上下文",
  "context.error": "{error} 本次读取未成功；不显示旧缓存，不补造已读或覆盖率。",
  "effort.aria": "实际候选修订记录",
  "effort.counts":
    "已记录正文修改 {updates} 次 · 显式合并 {rebases} 次 （其中正文变化 {changing} 次）",
  "effort.committed": "此原 AI 草稿链正式采用时 · 局部正文修订次数：{count}",
  "effort.uncommitted":
    "此原 AI 草稿链尚未正式采用 · 局部正文修订次数：{count}",
  "effort.unknown": "未知（历史不完整）",
  "effort.note":
    "仅本单章 AI 草稿链已保存的实际正文变化；相同内容重复保存不计数。不包含模型修订阶段、其他尝试、未保存编辑或编辑工作量，不证明文学质量。",
  "effort.partial":
    "旧记录缺失的历史不补零；上述次数只是已记录观察，不是完整修订总量。",
  "effort.range": "原记录范围",
  "effort.previews": "根预览 {root} · 当前预览 {preview} · {coverage}",
  "effort.journal": "台账 SHA256 {digest}",
  "effort.panel": "候选正文实际修订台账",
  "effort.pending": "正在核对原修订台账…",
  "effort.read": "查看 AI 草稿正文实际修订次数",
  "effort.error": "{error} 不显示旧缓存或推定零修订。",
  "verify.execution.foreign":
    "执行记录与指定原工作流版本、项目、操作或运行顺序不一致，请重新核对原运行。",
  "verify.context.foreignRun": "不能用其他运行替代本工作流原阶段上下文。",
  "verify.context.unrecorded":
    "原阶段未记录上下文快照；实际输入未知，不补用首次或最近运行。",
  "verify.context.foreign": "上下文快照与原运行或项目不一致。",
  "verify.context.digest":
    "原上下文字节与记录的指纹不一致，不能作为本轮输入展示。",
  "verify.context.moved": "读取期间原阶段绑定已变化，请重新核对。",
  "verify.effort.foreignPreview": "原 AI 草稿归属不一致，不读取其他预览。",
  "verify.effort.single": "修订台账仅支持指定的单章候选。",
  "verify.effort.foreign":
    "修订台账与原候选、章节、项目、任务或状态不一致，请重新读取原预览。",
  "verify.effort.digest": "原候选正文指纹无法核对，不展示其他内容的修订次数。",
  "usage.scope.response": "单响应报告（增量）",
  "usage.scope.run": "运行累计报告",
  "usage.scope.session": "会话累计报告（不是本次运行用量）",
  "usage.scope.unspecified": "计量口径未指定",
  "usage.token.invalid": "报告值无效",
  "usage.token.unreported": "未报告",
  "usage.aria": "引擎用量观测",
  "usage.run": "原运行 {runId} · 当前读取时共 {count} 条观测",
  "usage.scopeLine":
    "发生时范围：{scope}；对话后来绑定项目不会改写旧报告归属。",
  "usage.scope.project": "项目 {projectId}",
  "usage.scope.global": "未绑定项目的全局运行",
  "usage.empty": "没有已保存的报告，用量未知；不等于零。",
  "usage.item.scope": "{scope} · 游标 {cursor}",
  "usage.item.tokens": "输入 {input} · 输出 {output} · 缓存读取 {cached}",
  "usage.cost":
    "引擎报告费用估值：{amount} · {currency}；不是报价、账单或结算，不按 Token／当前单价补算或合计。",
  "usage.amount.invalid": "报告值无效",
  "usage.amount.unreported": "金额未报告",
  "usage.currency.invalid": "币种报告无效",
  "usage.currency.unreported": "币种未报告",
  "usage.noCost": "本条没有已记录的费用估值；不补造历史金额或币种，结算未知。",
  "usage.accounting": "输入口径：{accounting} · 保存时间 {at}",
  "usage.accounting.includes": "包含缓存",
  "usage.accounting.excludes": "不包含缓存",
  "usage.accounting.unspecified": "缓存包含关系未指定",
  "usage.note":
    "仅为引擎自行报告，覆盖可能不完整，未合计为本次运行总量。运行来源分类未知，费用与结算未知；不是实际付费、提效或文学质量证明。",
  "usage.panel": "运行用量只读记录",
  "usage.load.pending": "正在读取用量报告…",
  "usage.load.again": "重新读取原运行用量报告",
  "usage.load.first": "查看原运行用量报告",
  "usage.error": "{error} 上次记录仅作历史查看，不自动换运行或重试。",
  "usage.changed": "原分页身份已变化，请明确重新读取该运行。",
  "usage.older": "读取更早用量观测",
  "coverage.form.original": "完整原文",
  "coverage.form.summary": "已采用章节摘要",
  "coverage.form.paragraphs": "所选原文段落",
  "coverage.form.hierarchical": "高层冻结范围摘要",
  "coverage.title": "{label}（摘要／片段不是全文阅读）",
  "coverage.chapter": "{title} v{version}：{forms}",
  "coverage.summary.title": "高层摘要原冻结身份与章节版本",
  "coverage.summary.current":
    "{scope} · {id} v{version} · 冻结时完整范围有效；使用原覆盖，不扩大范围。",
  "coverage.summary.changed":
    "{scope} · {id} v{version} · 冻结时完整范围已变化；使用原覆盖，不扩大范围。",
  "coverage.references": "实际冻结引用与输入指纹（{count} 条）",
  "coverage.references.note":
    "仅列原冻结表达身份，不读取最新正文、改选来源或证明模型已经理解。",
  "coverage.omitted": "本冻结允许范围内未纳入的章节（{count} 章）",
  "coverage.omitted.note":
    "这里只是本次编译的允许范围，不是全书目录；范围外章节数量不能由本列表推断。",
  "coverage.omitted.empty": "{id} v{version} · 空章，未纳入表达",
  "coverage.omitted.unselected": "{id} v{version} · 明确未选，未纳入表达",
  "coverage.note":
    "完整纳入表达和引用声明不保证模型理解原著或语义判断正确；实际 usage／费用未提供时为未知。",
  "coverage.story.aria": "本轮冻结叙事解释",
  "coverage.story.title": "本轮冻结叙事解释 {count} 条",
  "coverage.story.note":
    "保留原声明／采用绑定、来源范围与实际输入指纹，不跟随最新目录换源。这里只纳入作者明确采用的解释和端点名称，未附带引文、正文或端点摘要；不增加整章表达覆盖，也不证明模型读过或理解原著。",
  "coverage.story.record": "实际 {kind} {id} v{version}",
  "coverage.story.fingerprint": "原来源指纹 {digest}",
  "coverage.story.input": "实际输入指纹 {digest}",
  "coverage.story.chapter": "原章节 {id} v{version}",
  "coverage.story.script": "原剧本 {id} v{version}",
  "coverage.quality.unknown":
    "冻结章节覆盖未提供；范围未知，不以空目录或 0 冒充已核全。",
  "coverage.quality.label": "质量评议原参考内容表达",
  "evidence.unrecorded":
    "此历史意见未记录 AI 草稿引文位置，不从最新稿补造证据。",
  "evidence.aria": "本轮候选引文定位",
  "evidence.title": "本轮候选引文位置（{count} 处）",
  "evidence.note":
    "仅记录逐字匹配，不证明模型判断正确；位置标签仍是 AI 审阅意见。字符位置为从 0 开始、末位不含的 UTF-16 区间。",
  "evidence.digest": "检查时候选 SHA-256：{digest}",
  "order.change.unchanged": "未改变",
  "order.change.added": "新增",
  "order.change.deleted": "移除",
  "order.change.modified": "正文修改",
  "order.change.moved": "位置移动",
  "order.change.conflict": "待选择冲突",
  "order.change.unmarked": "历史未标记",
  "order.unrecorded": "历史比较未提供块顺序协议，不补造位置或确认。",
  "order.aria": "剧本完整块顺序核对",
  "order.title": "完整块顺序与来源位置",
  "order.conflict":
    "排序存在冲突：不能猜测相对位置，须明确排列并确认全部保留块。",
  "order.settled":
    "当前规则可确定单方或一致顺序，并在明确稳定间隔保留另一侧新增块；不是语义安全证明。",
  "order.ids": "核对原基准／当前稿／AI 草稿的稳定 ID 顺序",
  "order.base": "原：{ids}",
  "order.current": "当前：{ids}",
  "order.candidate": "候选：{ids}",
  "order.fromCurrent": "以当前块顺序为排序起点",
  "order.fromCandidate": "以 AI 草稿块顺序为排序起点",
  "order.note":
    "排序起点不是采用决定：另一侧仅有的保留块会显示在列表末尾，请移动到明确位置；最终提交必须恰好包含全部所选稳定块。正文选择与排序分别核对，改变任一项会清除顺序确认。",
  "order.unit": "{position} · {id} · {change} · {side}",
  "order.side.current": "当前稿正文",
  "order.side.candidate": "AI 草稿正文",
  "order.up": "上移合并块 {position}",
  "order.down": "下移合并块 {position}",
  "order.confirm": "我已逐项核对完整块顺序（含增删与位置）；不代表语义安全",
  "sources.title": "引用资料 · {count} 项",
  "sources.frozen": "本次来源与版本已保存；AI 草稿采用时再次核对。",
  "sources.intent.adopted": "作者意图 · v{version}（冻结版本）",
  "sources.intent.none":
    "本轮开始时尚无正式作者意图；后来首次采用也会使此 AI 草稿失效。",
  "sources.intent.scope":
    "原明确允许范围与实际表达；未读取完整目录，不将解释来源章或所选段落计作全文已读。",
  "sources.intent.label": "AI 意图原参考内容表达",
  "sources.scope.noneAll": "明确不使用正文、段落或摘要",
  "sources.scope.none": "明确不使用正文",
  "sources.scope.full": "确认时的完整非空正文目录",
  "sources.scope.partial": "明确局部范围",
  "sources.production.scope":
    "制作原冻结范围：{scope}；{coverage}新来源选择不改变此运行；原输入重试仍用原冻结表达，采用或复检完成时核对实际来源。",
  "sources.production.unread":
    "正文目录未读取，章节总数和未纳入章数未知，不以 0 冒充完整覆盖。",
  "sources.production.read":
    "实际纳入 {included} 章，未纳入 {excluded} 章（目录共 {total} 章）。",
  "sources.production.label": "制作运行实际来源表达",
  "sources.planning.scope":
    "规划原冻结范围：{scope}；实际覆盖 {included} 章，未纳入 {excluded} 章。新选择不改变这一运行；原输入重试不换成最新来源，采用时仍核对原基准。",
  "sources.planning.label": "规划运行实际来源表达",
  "sources.budget":
    "完整首次提示估算 {estimated} token / 预算 {budget} token；实际 usage 与费用未知。",
  "sources.budget.frozen":
    "冻结上下文估算 {estimated} token / 预算 {budget} token；实际 usage 与费用未知。",
  "sources.context.coverage":
    "前文明确纳入 {included} 个不同章节，未纳入 {omitted} 章；直接表达中 {original} 章完整原文，{summary} 章采用摘要，{paragraphs} 章所选段落。摘要与片段不代表完整原文，覆盖不等于语义质量。",
  "sources.context.summary": "高层摘要的原冻结章节版本",
  "sources.context.summaryDetail":
    "高层采用摘要：{title} · {id} v{version}；原冻结覆盖 {count} 章，不是当前全书原文。",
  "sources.context.summaryStale": "完整范围已变化，仅保留所选冻结范围。",
  "sources.context.summaryFrozen": "编辑区新选择不改变这个运行。",
  "sources.summary":
    "实际冻结摘要范围：{title}；完整纳入 {references} 个非空章节，空章 {empty} 个不算已读。原文 {original} 章，已采用摘要 {summary} 章；编辑区新选择不改变这一运行的原冻结来源，引用与覆盖不保证语义概括正确。",
  "sources.quality":
    "质量评议实际表达：原文 {original} 章、章节摘要 {summary} 章、段落 {paragraphs} 章、高层摘要 {summaries} 条；覆盖并集不重复计章，摘要与段落不是全文评议。",
  "sources.quality.summary": "质量摘要冻结身份与逐章版本",
  "sources.adaptation.label": "改编运行实际来源表达",
  "sources.entry.included": "{title} · 已纳入",
  "sources.entry.excluded": "{title} · 未纳入",
  "sources.entry.tokens": " · 估算 {tokens} token",
  "sources.entry.source": "来源 {id} · 版本 {version} · {field}",
  "dialog.close": "关闭",
  "dialog.choose": "请选择",
  "scriptMerge.title": "剧本已有变化，请确认合并",
  "scriptMerge.description":
    "按稳定块保留独立正文修改，并核对完整顺序；正文冲突与位置冲突分别选择。合并只产生复检 AI 草稿，不自动采用。比较基准变化须重新打开，不自动换版本。",
  "scriptMerge.current": "当前剧本：{text}",
  "scriptMerge.candidate": "AI 候选：{text}",
  "scriptMerge.choice": "剧本冲突块选择",
  "scriptMerge.keepCurrent": "保留当前块",
  "scriptMerge.takeCandidate": "采用 AI 草稿块",
  "scriptMerge.submit": "合并并复检",
  "chapterMerge.title": "正文已有变化，请确认冲突段落",
  "chapterMerge.description":
    "不冲突的新增内容会自动保留。每处冲突都需要明确选择，关闭窗口会保留 AI 草稿。",
  "chapterMerge.base": "生成时正文",
  "chapterMerge.current": "当前正文",
  "chapterMerge.candidate": "AI 草稿",
  "chapterMerge.take": "此处采用",
  "chapterMerge.choice": "冲突段落选择",
  "chapterMerge.keepCurrent": "保留当前正文",
  "chapterMerge.takeCandidate": "采用 AI 草稿",
  "chapterMerge.both": "依次保留两段",
  "chapterMerge.submit": "确认合并并采用",
  "recovery.merge.invalid": "本地原合并请求格式无法核对，不能恢复或重发。",
  "recovery.merge.foreign": "本地原请求不属于当前项目／剧本，不能恢复或重发。",
  "recovery.merge.receipt": "实际合并回执与原请求不一致，不能恢复其他候选。",
  "recovery.merge.foreignCompare":
    "比较不属于当前项目、原候选或实际剧本，不能采用其他回复。",
  "recovery.redo.invalid": "本机原创建请求格式无法核对，未发出请求。",
  "recovery.redo.tooLarge": "原请求超出本机恢复范围，不截断或重建。",
  "recovery.redo.foreign": "原创建请求不属于当前项目或分集，不换其他请求。",
  "recovery.redo.occupied":
    "本机已有未核对原请求或完整请求超限，未覆盖、未发出新创建。",
  "recovery.redo.unsaved": "原完整请求与幂等键未持久保存，未发出创建。",
  "recovery.redo.uncleared": "原创建回执已取得，但本机待核对记录未解除。",
  "recovery.redo.unchecked": "本机原创建输入不能通过完整协议核对，未发出请求。",
  "recovery.redo.sendFailed": "原创建请求未完成，完整输入和幂等键仍保留。",
  "recovery.redo.receiptInvalid":
    "实际创建回执未通过完整协议核对，未清除原请求。",
  "recovery.redo.receiptKey":
    "实际创建缺少匹配的原输入哈希与幂等键回执，未解除待核对请求。",
  "recovery.redo.receiptInput":
    "实际创建回执与原完整输入、来源审阅不符，未恢复其他候选。",
  "operation.author-intent": "作者意图建议",
  "operation.chapter": "本章正文",
  "operation.story-setup": "故事设定",
  "operation.characters": "人物方案",
  "operation.book-outline": "全书大纲",
  "operation.chapter-outline": "章节大纲",
  "operation.story-arc": "卷与单元方案",
  "operation.episode": "本集剧本与分镜（旧 episode 兼容）",
  "operation.adaptation-diagnosis": "改编诊断",
  "operation.adaptation-strategy": "独立改编策略",
  "operation.season-plan": "整季分集方案",
  "operation.episode-outline": "单集大纲",
  "operation.episode-script": "单集标准剧本",
  "operation.storyboard-package": "单集分镜包",
  "operation.quality-review": "版本绑定的质量报告",
  "operation.script-revision": "剧本修订",
  "operation.review-check": "采用后审片复检",
  "operation.shot-prompt": "镜头提示词",
  "operation.delivery-copy": "交付文案",
  "operation.localization": "字幕与译文",
  "operation.creator-content": "选题与内容脚本",
  "operation.chapter-memory": "故事记忆",
  "operation.knowledge-plan": "故事与视觉设定",
  "operation.narrative-summary": "卷／故事弧／全书摘要",
  "stage.preparing": "准备上下文",
  "stage.generating": "AI 正在生成",
  "stage.checking": "检查 AI 草稿",
  "stage.revising": "局部修订",
  "stage.rechecking": "复检 AI 草稿",
  "stage.awaiting-review": "等待审阅采用",
  "stage.applied": "已采用",
  "stage.discarded": "已放弃",
  "stage.failed": "需要处理",
  "stage.canceled": "已取消",
  "stage.interrupted": "运行已中断",
  "stage.rechecked": "复检完成",
  "stage.ready": "准备创作",
  "workbench.aria": "AI {label}",
  "workbench.title": "AI · {label}",
  "workbench.defaultInstruction":
    "根据当前项目目标与已采用资料，生成并检查{label}。",
  "workbench.sourcesUnavailable":
    "制作来源选择未就绪，暂不能开始新的制作运行。",
  "workbench.listForeign":
    "创作运行目录的实际项目／目标或唯一身份无法核对，未选择最近 AI 草稿。",
  "workbench.workflowForeign":
    "指定原运行的实际身份／项目／操作／原冻结请求不符，未打开其他 AI 草稿。",
  "workbench.previewForeign":
    "指定原预览的实际身份／任务／目标不符，未显示可采用缓存。",
  "workbench.capabilityMissing":
    "当前创作能力未启用或连接未就绪，请恢复对应扩展后继续。",
  "workbench.planningRequired":
    "请先明确确认本轮规划范围与表达；原运行仍使用其参考内容。",
  "workbench.settingsLoading": "正在读取 AI 配置，请稍后重试。",
  "workbench.instruction.extra": "\n补充要求：",
  "workbench.instruction.selection":
    "\n仅修改以下选段，返回保持其他部分的完整正文：\n",
  "workbench.redo.changed": "本机原创建请求已经改变，实际回执未覆盖新记录。",
  "workbench.redo.storageChanged": "本机原请求已变化，未重发旧内存输入。",
  "workbench.redo.receiptMismatch":
    "实际回执已取得，本机原请求不一致，未覆盖其他记录。",
  "workbench.redo.aria": "原来源重做创建请求待核对",
  "workbench.redo.note":
    "原完整创建输入与幂等键已保留，不使用当前改写要求、配置或最新来源重建。重发可能启动尚未建立的原请求；已有回执时仅返回同一运行，不自动重发。",
  "workbench.redo.unreadable": "本机原请求不可核对，未删除或覆盖。{error}",
  "workbench.redo.request": "原请求 {key} · 原关联 {attribution}",
  "workbench.redo.resend": "重发原来源重做创建请求（不换键）",
  "workbench.merge.aria": "原剧本合并请求恢复",
  "workbench.merge.note":
    "存在尚未核对回执的本地原合并请求。不会自动重发、刷新比较基准或新建幂等键；重发仍可能启动原请求，已存在时只返回同一 AI 草稿。",
  "workbench.merge.unreadable": "{error} 原记录仍保留，不能自动替换。",
  "workbench.merge.request":
    "原候选 {workflowId} · 实际剧本版本 {version} · 原请求 {key}",
  "workbench.merge.resend": "重发原合并请求并核对回执",
  "workbench.merge.dropNote":
    "删除本地记录不撤销服务端 AI 草稿；若请求已成功，仍须从原运行列表查看、采用或放弃。",
  "workbench.merge.drop": "仅删除已核对的本地重发记录",
  "workbench.merge.dropChanged": "本地记录已变化或无法核对，不能删除其他请求。",
  "workbench.merge.noTarget": "缺少实际剧本归属。",
  "workbench.merge.unchecked": "原合并请求尚未核对，不能替换为新请求。",
  "workbench.rechecking.kept":
    "正在重核指定原运行；保留上次实际原快照，操作暂不可用。",
  "workbench.rechecking.none":
    "正在重核指定原运行；未恢复缓存 AI 草稿或重新生成。",
  "workbench.failure.read":
    "指定原运行或原预览读取失败，未使用可操作旧缓存；创作要求保留，不切换最近运行。",
  "workbench.failure.kept": "创作要求和已返回的 AI 草稿仍然保留。",
  "workbench.checkConnection": "检查 AI 连接",
  "workbench.capabilityOff":
    "当前创作能力未启用。已有要求和 AI 草稿保留，可在扩展设置恢复对应功能。",
  "workbench.intro":
    "提出目标，AI 会生成、检查并在必要时修订一次，完成后交给你审阅。",
  "workbench.selected": "已选段落：{text}",
  "workbench.brief": "本次方案与目标",
  "workbench.draftTitle": "AI 草稿方案",
  "workbench.adoptionCheck": "查看采用后的原问题复检",
  "workbench.adoptionCheckFailed": "采用后复检未启动：{error}",
  "workbench.memory.synced": "故事资料：已按采用版本更新",
  "workbench.memory.running": "故事资料：正在提取与检查",
  "workbench.memory.review-required":
    "故事资料：有新增资料需要审阅，可在任务中心处理",
  "workbench.memory.other": "故事资料：{detail}",
  "workbench.memory.failed": "更新未完成，正式正文已保留",
  "workbench.issues": "检查与修订",
  "workbench.issue.rule": "规则检查",
  "workbench.issue.model": "AI 审阅",
  "workbench.instruction.optional": "补充要求（可选）",
  "workbench.instruction.revise": "修改要求",
  "workbench.instruction.goal": "创作目标",
  "workbench.instruction.aria": "AI 创作要求",
  "workbench.instruction.placeholder":
    "可直接点选上方操作；也可补充风格、情节或修改要求。",
  "workbench.cancel": "停止生成",
  "workbench.review.before": "请在",
  "review.intent": "作者意图工作台",
  "review.intent.hint":
    "中核对八字段差异与实际来源，再明确采用或放弃；不改原稿。",
  "review.strategy": "独立策略 AI 草稿",
  "review.strategy.hint":
    "中比较 2–3 个不同动作方案，再明确采用一个或放弃；不生成季纲或改原稿。",
  "review.quality": "质量报告工作台",
  "review.quality.hint":
    "中核对逐字证据与实际版本，再明确采用报告或放弃；不改正文。",
  "review.season": "整季方案 AI 草稿",
  "review.season.hint": "中核对来源覆盖与完整顺序，再明确采用或放弃。",
  "review.diagnosis": "诊断 AI 草稿",
  "review.diagnosis.hint": "中比较策略，并明确选择一个策略后采用或放弃。",
  "workbench.adopt": "采用",
  "workbench.adoptNext": "采用并生成下一章",
  "workbench.discard": "放弃 AI 草稿",
  "workbench.start": "生成并检查{label}",
  "workbench.resolveConflict": "解决版本冲突",
  "workbench.restart": "按要求生成新 AI 草稿",
  "workbench.retry": "沿用原输入重试",
  "workbench.continue": "保留 AI 草稿重新检查",
  "workbench.episodeLegacy":
    "旧 episode 兼容工作流：原 AI 草稿、来源快照与回执保留。此处仍使用旧的一体化采用规则，不会自动转成独立大纲、标准剧本或分镜版本。",
  "run.foreign": "指定创作运行的实际身份、项目或任务绑定不符；未打开 AI 草稿。",
  "run.loading": "正在读取创作运行…",
  "record.defaultLanguage": "英语",
  "record.loading": "正在读取当前对象…",
  "record.foreign": "指定创作对象的身份或项目归属不符，未打开 AI 草稿。",
  "record.language": "目标语言",
  "version.of": "{id} v{version}",
  "version.titled": "{id} v{version} · {title}",
  "version.kind": "{kind} {id} v{version}",
  "version.digest": "SHA-256 {hash}",
} as const;

/** English copy, key for key. */
export const creationEn: Record<keyof typeof creationZh, string> = {
  "progress.aria": "Live AI feedback",
  "progress.ended": "Content returned this time",
  "progress.elapsed.aria": "Creation time elapsed",
  "progress.elapsed": "{time} elapsed",
  "progress.seconds": "{seconds} s",
  "progress.minutes": "{minutes} min {seconds} s",
  "progress.steps.aria": "Creation steps",
  "progress.step.prepare": "Prepare material",
  "progress.step.generate": "Generate AI draft",
  "progress.step.check": "Check and revise",
  "progress.step.review": "Await review",
  "progress.stage.preparing": "Preparing creation material",
  "progress.stage.generating": "Generating text and plan",
  "progress.stage.checking": "Checking the AI draft",
  "progress.stage.revising": "Revising the AI draft",
  "progress.stage.rechecking": "Rechecking the AI draft",
  "progress.waiting.preparing":
    "Gathering this chapter, the creation request and adopted material",
  "progress.waiting.generating": "Waiting for the model to return content",
  "progress.waiting.checking":
    "Checking the request, plot and material for consistency; waiting for the result",
  "progress.waiting.revising":
    "Revising from the check findings; waiting for the revision",
  "progress.waiting.rechecking":
    "Checking the revision; waiting for the recheck verdict",
  "progress.returning.check": "Check results are arriving",
  "progress.returning.content":
    "Content is arriving; watch the live preview below",
  "progress.preview.check": "Live check feedback",
  "progress.preview.content": "Live content preview",
  "progress.preview.ended": "Generated fragment (not adopted)",
  "progress.preview.aria": "Content the AI is returning",
  "progress.length": "{count} characters returned",
  "progress.after.active":
    "Once checked, an AI draft is created for you to review and adopt.",
  "progress.after.ended":
    "This run did not finish; the returned fragment is kept for viewing.",
  "progress.slow":
    "When the model responds slowly the wait time keeps updating; you can also stop generating.",
  "progress.itemsError":
    "Live content cannot be read right now; reconnecting. The task status keeps updating.",
  "execution.phase.generating": "generation",
  "execution.phase.checking": "check",
  "execution.phase.revising": "local revision",
  "execution.phase.rechecking": "recheck",
  "execution.phase.unknown": "stage unknown",
  "execution.aria": "Creation stage execution receipt",
  "execution.workflow":
    "Workflow {workflowId} · version {version} · {operation}",
  "execution.scope":
    "This workflow attempt only, in its run order; not a total across retries.",
  "execution.source":
    " Previous workflow: {workflowId}; its usage is not included.",
  "execution.cost":
    " Cost and settlement are unknown; passing the checks is not proof of literary quality.",
  "execution.none":
    "No run assigned yet; this does not mean zero usage or completion.",
  "execution.run": "{index}. {phase} · run {runId}",
  "execution.missing":
    "The run was not created yet or is missing; model, time and usage are unknown. No recent run is used instead.",
  "execution.engine": "Engine {engine} · saved status {status}",
  "execution.model": "Saved model: {model}",
  "execution.model.invalid": "the record is invalid",
  "execution.model.unrecorded":
    "unrecorded; the current default model is not used to fill it",
  "execution.timing": "Run start and end (including preparation): {timing}",
  "execution.timing.measured": "{startedAt} → {completedAt} · {durationMs} ms",
  "execution.timing.progress":
    "started {startedAt}; no end time recorded, so no final duration is inferred",
  "execution.timing.invalid":
    "the times are invalid or reversed; not filled with zero",
  "execution.timing.unrecorded": "not fully recorded; duration unknown",
  "execution.panel": "All creation stage execution records",
  "execution.pending": "Checking the stage records…",
  "execution.read": "See all creation stage execution records",
  "execution.error":
    "{error} The stages could not be read; no old cache or other run is used.",
  "context.aria": "Stage context snapshot",
  "context.run": "Run {runId} · snapshot {snapshotId}",
  "context.tokens":
    "Full prompt estimate {estimated} tokens / budget {budget} tokens; not actual usage.",
  "context.entries":
    "{included} entries included, {excluded} excluded. These are entry counts, not chapter coverage of the book; summaries, paragraphs and author notes are not a full reading.",
  "context.note":
    "The saved input and the reasons for exclusions follow; the latest text and the first generation's context are not used instead. Unrecorded trimming is not inferred, inclusion does not prove the model read or understood it, and byte digests do not certify history or literary quality.",
  "context.promptDigest": "Prompt SHA-256 {digest}",
  "context.manifestDigest": "Manifest SHA-256 {digest}",
  "context.entry": "{kind} {id} v{version} · {state}",
  "context.included": "included",
  "context.excluded": "excluded",
  "context.entryReason": "{field} · {reason} · estimate {tokens} tokens",
  "context.entryValue": "See this frozen entry",
  "context.prompt":
    "See this stage's full prompt (may contain local private text or AI drafts)",
  "context.panel": "Stage context {runId}",
  "context.pending": "Reading the stage context…",
  "context.read": "See this stage's context",
  "context.error":
    "{error} This read failed; no old cache is shown and no reading or coverage is made up.",
  "effort.aria": "Recorded draft revisions",
  "effort.counts":
    "{updates} recorded text edits · {rebases} explicit merges ({changing} changed the text)",
  "effort.committed":
    "When this AI draft chain was adopted · local text revisions: {count}",
  "effort.uncommitted":
    "This AI draft chain is not adopted yet · local text revisions: {count}",
  "effort.unknown": "unknown (history incomplete)",
  "effort.note":
    "Only the saved text changes of this one chapter's AI draft chain; saving the same content again is not counted. Model revision stages, other attempts, unsaved edits and editing effort are excluded; this is not proof of literary quality.",
  "effort.partial":
    "History missing from old records is not filled with zero; the counts above are recorded observations, not the full revision total.",
  "effort.range": "Record scope",
  "effort.previews":
    "Root preview {root} · current preview {preview} · {coverage}",
  "effort.journal": "Journal SHA256 {digest}",
  "effort.panel": "Draft text revision journal",
  "effort.pending": "Checking the revision journal…",
  "effort.read": "See the AI draft's recorded text revisions",
  "effort.error": "{error} No old cache or presumed zero revisions are shown.",
  "verify.execution.foreign":
    "The execution records do not match this workflow's version, project, operation or run order; check the runs again.",
  "verify.context.foreignRun":
    "Another run cannot stand in for this workflow's stage context.",
  "verify.context.unrecorded":
    "The stage recorded no context snapshot; the actual input is unknown, and the first or latest run is not used instead.",
  "verify.context.foreign":
    "The context snapshot does not match the run or project.",
  "verify.context.digest":
    "The context bytes do not match their recorded digests and cannot be shown as this run's input.",
  "verify.context.moved":
    "The stage binding changed during the read; check again.",
  "verify.effort.foreignPreview":
    "The AI draft belongs elsewhere; no other preview is read.",
  "verify.effort.single":
    "The revision journal only covers a single-chapter draft.",
  "verify.effort.foreign":
    "The revision journal does not match the draft, chapter, project, task or status; read the preview again.",
  "verify.effort.digest":
    "The draft text digest cannot be checked; revision counts of other content are not shown.",
  "usage.scope.response": "Per-response report (increment)",
  "usage.scope.run": "Run total report",
  "usage.scope.session": "Session total report (not this run's usage)",
  "usage.scope.unspecified": "Measurement scope unspecified",
  "usage.token.invalid": "invalid report",
  "usage.token.unreported": "unreported",
  "usage.aria": "Engine usage observations",
  "usage.run": "Run {runId} · {count} observations when read",
  "usage.scopeLine":
    "Scope at the time: {scope}; binding the conversation to a project later does not move old reports.",
  "usage.scope.project": "project {projectId}",
  "usage.scope.global": "a global run with no project",
  "usage.empty": "No saved reports; usage is unknown, not zero.",
  "usage.item.scope": "{scope} · cursor {cursor}",
  "usage.item.tokens": "Input {input} · output {output} · cache read {cached}",
  "usage.cost":
    "Engine-reported cost estimate: {amount} · {currency}; not a quote, bill or settlement, and never recomputed from tokens or current prices or added up.",
  "usage.amount.invalid": "invalid report",
  "usage.amount.unreported": "amount unreported",
  "usage.currency.invalid": "invalid currency report",
  "usage.currency.unreported": "currency unreported",
  "usage.noCost":
    "No cost estimate recorded for this item; no historical amount or currency is made up, and settlement is unknown.",
  "usage.accounting": "Input accounting: {accounting} · saved at {at}",
  "usage.accounting.includes": "includes cache",
  "usage.accounting.excludes": "excludes cache",
  "usage.accounting.unspecified": "cache inclusion unspecified",
  "usage.note":
    "The engine's own reports only; coverage may be incomplete and nothing is totalled for the run. Run source classification, cost and settlement are unknown; this is not proof of payment, efficiency or literary quality.",
  "usage.panel": "Run usage records (read-only)",
  "usage.load.pending": "Reading usage reports…",
  "usage.load.again": "Read the run's usage reports again",
  "usage.load.first": "See the run's usage reports",
  "usage.error":
    "{error} The previous records stay for history only; no other run or retry is tried.",
  "usage.changed": "The page identity changed; read this run again explicitly.",
  "usage.older": "Read older usage observations",
  "coverage.form.original": "full original text",
  "coverage.form.summary": "adopted chapter summary",
  "coverage.form.paragraphs": "selected original paragraphs",
  "coverage.form.hierarchical": "frozen higher-level scope summary",
  "coverage.title": "{label} (summaries and excerpts are not a full reading)",
  "coverage.chapter": "{title} v{version}: {forms}",
  "coverage.summary.title":
    "Frozen identity and chapter versions of the higher-level summary",
  "coverage.summary.current":
    "{scope} · {id} v{version} · the full scope was current when frozen; the original coverage is used and not widened.",
  "coverage.summary.changed":
    "{scope} · {id} v{version} · the full scope had changed when frozen; the original coverage is used and not widened.",
  "coverage.references": "Frozen references and input digests ({count})",
  "coverage.references.note":
    "Only the frozen entries' identities; the latest text is not read, sources are not reselected, and nothing proves the model understood them.",
  "coverage.omitted":
    "Chapters within the frozen scope that were left out ({count})",
  "coverage.omitted.note":
    "This is only the scope this compilation allowed, not the book's table of contents; chapters outside it cannot be counted from this list.",
  "coverage.omitted.empty": "{id} v{version} · empty chapter, not included",
  "coverage.omitted.unselected":
    "{id} v{version} · explicitly not selected, not included",
  "coverage.note":
    "Including entries in full and declaring references does not ensure the model understood the source or judged correctly; usage and cost are unknown when not reported.",
  "coverage.story.aria": "Frozen narrative interpretations of this run",
  "coverage.story.title":
    "{count} frozen narrative interpretations in this run",
  "coverage.story.note":
    "The original declaration or adoption binding, source scope and input digest are kept; sources do not follow the latest catalog. Only interpretations the author adopted and endpoint names are included, without quotations, text or endpoint summaries; this adds no chapter coverage and does not prove the model read or understood the source.",
  "coverage.story.record": "Actual {kind} {id} v{version}",
  "coverage.story.fingerprint": "Source fingerprint {digest}",
  "coverage.story.input": "Input digest {digest}",
  "coverage.story.chapter": "Chapter {id} v{version}",
  "coverage.story.script": "Script {id} v{version}",
  "coverage.quality.unknown":
    "Frozen chapter coverage was not provided; the scope is unknown and an empty list or 0 is not presented as fully checked.",
  "coverage.quality.label": "Reference material of the quality review",
  "evidence.unrecorded":
    "This earlier finding recorded no quotation positions in the AI draft; no evidence is made up from the latest draft.",
  "evidence.aria": "Quotation positions in this draft",
  "evidence.title": "Quotation positions in this draft ({count})",
  "evidence.note":
    "Only verbatim matches are recorded, which does not prove the model judged correctly; the position labels are still AI review findings. Positions are zero-based, end-exclusive UTF-16 ranges.",
  "evidence.digest": "Draft SHA-256 when checked: {digest}",
  "order.change.unchanged": "unchanged",
  "order.change.added": "added",
  "order.change.deleted": "removed",
  "order.change.modified": "text changed",
  "order.change.moved": "moved",
  "order.change.conflict": "conflict to choose",
  "order.change.unmarked": "not marked in history",
  "order.unrecorded":
    "The earlier comparison has no block order; no positions or confirmation are made up.",
  "order.aria": "Full script block order check",
  "order.title": "Full block order and source positions",
  "order.conflict":
    "The orders conflict: relative positions cannot be guessed; arrange and confirm every kept block explicitly.",
  "order.settled":
    "The rules settle a one-sided or agreed order and keep the other side's added blocks at definite stable gaps; this is not proof of semantic safety.",
  "order.ids":
    "Check the stable ID order of the base, the current script and the AI draft",
  "order.base": "Base: {ids}",
  "order.current": "Current: {ids}",
  "order.candidate": "Draft: {ids}",
  "order.fromCurrent": "Start from the current block order",
  "order.fromCandidate": "Start from the AI draft's block order",
  "order.note":
    "A starting order is not an adoption decision: kept blocks only the other side has appear at the end; move them to a definite position. The final commit must contain exactly every selected stable block. Text choices and order are checked separately, and changing either clears the order confirmation.",
  "order.unit": "{position} · {id} · {change} · {side}",
  "order.side.current": "current script text",
  "order.side.candidate": "AI draft text",
  "order.up": "Move merge block {position} up",
  "order.down": "Move merge block {position} down",
  "order.confirm":
    "I checked the full block order item by item (additions, removals and positions); this does not mean it is semantically safe",
  "sources.title": "Sources · {count}",
  "sources.frozen":
    "This run's sources and versions are saved; they are checked again when the AI draft is adopted.",
  "sources.intent.adopted": "Author intent · v{version} (frozen version)",
  "sources.intent.none":
    "There was no adopted author intent when this run started; adopting one for the first time later also invalidates this AI draft.",
  "sources.intent.scope":
    "The scope originally allowed and how it was actually given; the full directory was not read, and explained source chapters or chosen paragraphs do not count as reading the whole text.",
  "sources.intent.label": "How the AI intent's reference content was given",
  "sources.scope.noneAll":
    "explicitly no chapter text, paragraphs or summaries",
  "sources.scope.none": "explicitly no chapter text",
  "sources.scope.full": "the whole non-empty chapter directory when confirmed",
  "sources.scope.partial": "an explicit partial scope",
  "sources.production.scope":
    "Production's frozen scope: {scope}; {coverage} A new source choice does not change this run; a retry with the original input keeps the frozen form, and the actual sources are checked on adoption or when the recheck finishes.",
  "sources.production.unread":
    "the chapter directory was not read, so the chapter total and the chapters left out are unknown; 0 does not stand for full coverage.",
  "sources.production.read":
    "{included} chapters included, {excluded} left out ({total} in the directory).",
  "sources.production.label": "How the production run's sources were given",
  "sources.planning.scope":
    "Planning's frozen scope: {scope}; {included} chapters covered, {excluded} left out. A new choice does not change this run; a retry with the original input does not switch to the latest sources, and adoption still checks the original basis.",
  "sources.planning.label": "How the planning run's sources were given",
  "sources.budget":
    "Whole first prompt estimated at {estimated} tokens / budget {budget} tokens; actual usage and cost are unknown.",
  "sources.budget.frozen":
    "Frozen context estimated at {estimated} tokens / budget {budget} tokens; actual usage and cost are unknown.",
  "sources.context.coverage":
    "Earlier text explicitly includes {included} distinct chapters, {omitted} left out; of those given directly, {original} are the whole original, {summary} adopted summaries and {paragraphs} chosen paragraphs. Summaries and excerpts are not the whole original, and coverage is not semantic quality.",
  "sources.context.summary": "The chapter versions a higher summary froze",
  "sources.context.summaryDetail":
    "Adopted higher summary: {title} · {id} v{version}; it froze {count} chapters and is not the current whole text.",
  "sources.context.summaryStale":
    " The whole scope has changed; only the chosen frozen scope is kept.",
  "sources.context.summaryFrozen":
    " A new choice in the editor does not change this run.",
  "sources.summary":
    "Frozen summary scope: {title}; {references} non-empty chapters fully included, {empty} empty chapters do not count as read. {original} original, {summary} adopted summaries; a new choice in the editor does not change this run's frozen sources, and references and coverage do not guarantee a correct summary.",
  "sources.quality":
    "What the quality review was given: {original} original chapters, {summary} chapter summaries, {paragraphs} paragraph excerpts and {summaries} higher summaries; the union counts each chapter once, and summaries and paragraphs are not a whole-text review.",
  "sources.quality.summary":
    "The quality summary's frozen identity and chapter versions",
  "sources.adaptation.label": "How the adaptation run's sources were given",
  "sources.entry.included": "{title} · included",
  "sources.entry.excluded": "{title} · not included",
  "sources.entry.tokens": " · estimated {tokens} tokens",
  "sources.entry.source": "Source {id} · version {version} · {field}",
  "dialog.close": "Close",
  "dialog.choose": "Choose",
  "scriptMerge.title": "The script has changed; confirm the merge",
  "scriptMerge.description":
    "Independent text changes are kept by stable block and the full order is checked; text conflicts and position conflicts are chosen separately. The merge only produces a rechecked AI draft and adopts nothing. If the comparison basis changes, reopen it; the version is not switched for you.",
  "scriptMerge.current": "Current script: {text}",
  "scriptMerge.candidate": "AI candidate: {text}",
  "scriptMerge.choice": "Choice for a conflicting script block",
  "scriptMerge.keepCurrent": "Keep the current block",
  "scriptMerge.takeCandidate": "Take the AI draft's block",
  "scriptMerge.submit": "Merge and recheck",
  "chapterMerge.title":
    "The chapter has changed; settle the conflicting passages",
  "chapterMerge.description":
    "New text that does not conflict is kept. Every conflict needs an explicit choice; closing the window keeps the AI draft.",
  "chapterMerge.base": "Text when generated",
  "chapterMerge.current": "Current text",
  "chapterMerge.candidate": "AI draft",
  "chapterMerge.take": "Use here",
  "chapterMerge.choice": "Choice for a conflicting passage",
  "chapterMerge.keepCurrent": "Keep the current text",
  "chapterMerge.takeCandidate": "Take the AI draft",
  "chapterMerge.both": "Keep both, in turn",
  "chapterMerge.submit": "Merge and adopt",
  "recovery.merge.invalid":
    "The kept merge request cannot be checked, so it is not restored or sent again.",
  "recovery.merge.foreign":
    "The kept request belongs to another project or script, so it is not restored or sent again.",
  "recovery.merge.receipt":
    "The merge receipt does not match the original request, so no other candidate is restored.",
  "recovery.merge.foreignCompare":
    "The comparison belongs to another project, candidate or script, so no other answer is used.",
  "recovery.redo.invalid":
    "The kept start request cannot be checked, so nothing was sent.",
  "recovery.redo.tooLarge":
    "The original request is too large to keep on this device; it is not cut down or rebuilt.",
  "recovery.redo.foreign":
    "The original start request belongs to another project or episode; no other request is used.",
  "recovery.redo.occupied":
    "An unchecked original request is already kept, or the request is too large; nothing was overwritten or started.",
  "recovery.redo.unsaved":
    "The whole original request and its idempotency key were not saved, so nothing was started.",
  "recovery.redo.uncleared":
    "The start receipt arrived, but the kept request on this device was not cleared.",
  "recovery.redo.unchecked":
    "The kept start input does not pass the full protocol check, so nothing was sent.",
  "recovery.redo.sendFailed":
    "The original start did not complete; the whole input and idempotency key are still kept.",
  "recovery.redo.receiptInvalid":
    "The start receipt does not pass the full protocol check, so the original request is kept.",
  "recovery.redo.receiptKey":
    "The start has no receipt matching the original input hash and idempotency key, so the kept request stays.",
  "recovery.redo.receiptInput":
    "The start receipt does not match the whole original input or source review, so no other candidate is restored.",
  "operation.author-intent": "Author intent suggestion",
  "operation.chapter": "Chapter text",
  "operation.story-setup": "Story setup",
  "operation.characters": "Character plan",
  "operation.book-outline": "Book outline",
  "operation.chapter-outline": "Chapter outline",
  "operation.story-arc": "Volume and arc plan",
  "operation.episode": "Episode script and storyboard (legacy episode)",
  "operation.adaptation-diagnosis": "Adaptation diagnosis",
  "operation.adaptation-strategy": "Adaptation strategy",
  "operation.season-plan": "Season episode plan",
  "operation.episode-outline": "Episode outline",
  "operation.episode-script": "Episode script",
  "operation.storyboard-package": "Episode storyboard package",
  "operation.quality-review": "Version-bound quality report",
  "operation.script-revision": "Script revision",
  "operation.review-check": "Post-adoption review recheck",
  "operation.shot-prompt": "Shot prompts",
  "operation.delivery-copy": "Delivery copy",
  "operation.localization": "Subtitles and translation",
  "operation.creator-content": "Topics and content scripts",
  "operation.chapter-memory": "Story memory",
  "operation.knowledge-plan": "Story and visual settings",
  "operation.narrative-summary": "Volume, arc or book summary",
  "stage.preparing": "Preparing context",
  "stage.generating": "AI is generating",
  "stage.checking": "Checking the AI draft",
  "stage.revising": "Revising locally",
  "stage.rechecking": "Rechecking the AI draft",
  "stage.awaiting-review": "Waiting for review",
  "stage.applied": "Adopted",
  "stage.discarded": "Discarded",
  "stage.failed": "Needs attention",
  "stage.canceled": "Canceled",
  "stage.interrupted": "Run interrupted",
  "stage.rechecked": "Recheck finished",
  "stage.ready": "Ready to create",
  "workbench.aria": "AI {label}",
  "workbench.title": "AI · {label}",
  "workbench.defaultInstruction":
    "Generate and check the {label} from the project's goals and adopted material.",
  "workbench.sourcesUnavailable":
    "The production source picker is not ready, so a new production run cannot start yet.",
  "workbench.listForeign":
    "The run list's project, target or identities cannot be checked, so no latest AI draft is chosen.",
  "workbench.workflowForeign":
    "The named run's identity, project, operation or frozen request does not match, so no other AI draft is opened.",
  "workbench.previewForeign":
    "The named preview's identity, task or target does not match, so no adoptable cache is shown.",
  "workbench.capabilityMissing":
    "This creation capability is off or not connected; restore its extension to continue.",
  "workbench.planningRequired":
    "Confirm this round's planning scope and form first; the original run keeps its reference content.",
  "workbench.settingsLoading":
    "Reading the AI settings; try again in a moment.",
  "workbench.instruction.extra": "\nAdditional requirements: ",
  "workbench.instruction.selection":
    "\nRevise only the passage below and return the whole text with everything else kept:\n",
  "workbench.redo.changed":
    "The kept start request changed on this device; the receipt did not overwrite the new record.",
  "workbench.redo.storageChanged":
    "The kept request changed on this device, so the old in-memory input was not sent again.",
  "workbench.redo.receiptMismatch":
    "The receipt arrived, but the kept request no longer matches, so no other record was overwritten.",
  "workbench.redo.aria": "Source redo start request waiting to be checked",
  "workbench.redo.note":
    "The whole original start input and its idempotency key are kept; nothing is rebuilt from the current requirements, settings or latest sources. Sending again may start the original request if it never began; if it did, the same run comes back. Nothing is sent automatically.",
  "workbench.redo.unreadable":
    "The kept request cannot be checked; it was not deleted or overwritten. {error}",
  "workbench.redo.request": "Original request {key} · linked to {attribution}",
  "workbench.redo.resend": "Send the source redo start again (same key)",
  "workbench.merge.aria": "Restore the original script merge request",
  "workbench.merge.note":
    "A kept merge request has no checked receipt. It is not sent again automatically, the comparison basis is not refreshed and no new idempotency key is made; sending again may still start the original request, and if it exists the same AI draft comes back.",
  "workbench.merge.unreadable":
    "{error} The original record is kept and cannot be replaced automatically.",
  "workbench.merge.request":
    "Original candidate {workflowId} · script version {version} · original request {key}",
  "workbench.merge.resend":
    "Send the original merge again and check its receipt",
  "workbench.merge.dropNote":
    "Deleting the kept record does not withdraw the AI draft on the server; if the request succeeded, view, adopt or discard it from the run list.",
  "workbench.merge.drop": "Delete only the checked kept record",
  "workbench.merge.dropChanged":
    "The kept record changed or cannot be checked, so no other request is deleted.",
  "workbench.merge.noTarget": "The script this merges into is missing.",
  "workbench.merge.unchecked":
    "The original merge request is not checked yet and cannot be replaced by a new one.",
  "workbench.rechecking.kept":
    "Rechecking the named run; the last checked snapshot stays and actions wait.",
  "workbench.rechecking.none":
    "Rechecking the named run; no cached AI draft is restored and nothing is regenerated.",
  "workbench.failure.read":
    "The named run or preview could not be read, so no actionable old cache is used; your requirements are kept and the latest run is not switched to.",
  "workbench.failure.kept":
    "Your requirements and any AI draft returned are still kept.",
  "workbench.checkConnection": "Check the AI connection",
  "workbench.capabilityOff":
    "This creation capability is off. Requirements and AI drafts are kept; restore it in the extension settings.",
  "workbench.intro":
    "Set a goal; the AI generates, checks, revises once if needed, then hands the draft to you for review.",
  "workbench.selected": "Selected passage: {text}",
  "workbench.brief": "This run's plan and goal",
  "workbench.draftTitle": "AI draft",
  "workbench.adoptionCheck": "View the post-adoption recheck",
  "workbench.adoptionCheckFailed":
    "The post-adoption recheck did not start: {error}",
  "workbench.memory.synced": "Story material: updated from the adopted version",
  "workbench.memory.running": "Story material: extracting and checking",
  "workbench.memory.review-required":
    "Story material: new material needs review in the task center",
  "workbench.memory.other": "Story material: {detail}",
  "workbench.memory.failed":
    "the update did not finish; the adopted text is kept",
  "workbench.issues": "Checks and revisions",
  "workbench.issue.rule": "Rule check",
  "workbench.issue.model": "AI review",
  "workbench.instruction.optional": "Additional requirements (optional)",
  "workbench.instruction.revise": "Revision requirements",
  "workbench.instruction.goal": "Creation goal",
  "workbench.instruction.aria": "AI creation requirements",
  "workbench.instruction.placeholder":
    "Pick an action above, or add style, plot or revision requirements.",
  "workbench.cancel": "Stop generating",
  "workbench.review.before": "Go to the ",
  "review.intent": "author intent workbench",
  "review.intent.hint":
    " to check the eight fields' differences and actual sources, then adopt or discard; the manuscript is not changed.",
  "review.strategy": "strategy AI draft",
  "review.strategy.hint":
    " to compare 2–3 different plans, then adopt one or discard; no season outline is generated and the manuscript is not changed.",
  "review.quality": "quality report workbench",
  "review.quality.hint":
    " to check the verbatim evidence and actual versions, then adopt the report or discard; the text is not changed.",
  "review.season": "season plan AI draft",
  "review.season.hint":
    " to check source coverage and the full order, then adopt or discard.",
  "review.diagnosis": "diagnosis AI draft",
  "review.diagnosis.hint":
    " to compare strategies, choose one, then adopt or discard.",
  "workbench.adopt": "Adopt",
  "workbench.adoptNext": "Adopt and generate the next chapter",
  "workbench.discard": "Discard the AI draft",
  "workbench.start": "Generate and check: {label}",
  "workbench.resolveConflict": "Resolve the version conflict",
  "workbench.restart": "Generate a new AI draft from the requirements",
  "workbench.retry": "Retry with the original input",
  "workbench.continue": "Keep the AI draft and check again",
  "workbench.episodeLegacy":
    "Legacy episode workflow: the original AI draft, source snapshot and receipt are kept. It still adopts by the old all-in-one rule and is not split into a separate outline, script or storyboard version.",
  "run.foreign":
    "The named run's identity, project or task does not match; no AI draft is opened.",
  "run.loading": "Reading the creation run…",
  "record.defaultLanguage": "English",
  "record.loading": "Reading the record…",
  "record.foreign":
    "The record's identity or project does not match, so no AI draft is opened.",
  "record.language": "Target language",
  "version.of": "{id} v{version}",
  "version.titled": "{id} v{version} · {title}",
  "version.kind": "{kind} {id} v{version}",
  "version.digest": "SHA-256 {hash}",
};
