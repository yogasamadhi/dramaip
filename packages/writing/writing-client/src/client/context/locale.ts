/**
 * Copy of the narrative context picker: the chapter, higher summary and
 * story index sources a creation run is explicitly given.
 */
export const zh = {
  "story.group": "{kind}：{title} v{version}",
  "story.group.book": "全书",
  "story.group.volume": "卷",
  "story.group.story-arc": "故事弧",
  "story.reason.project": "声明不属于当前项目。",
  "story.reason.unverified": "声明尚未通过实际来源核对。",
  "story.reason.script": "包含剧本来源，不能静默纳入本轮小说章节范围。",
  "story.reason.noChapter": "没有本轮章节来源，不当作原著上下文。",
  "story.reason.scope":
    "包含未确认范围、当前章／后文或旧章节版本；不能截掉部分来源使用。",
  "story.endpoint": "{title} v{version}（{id}）",
  "story.endpoint.missing": "原端点暂未核全",
  "story.connection.relationship": "{from} → {relation} → {to}",
  "story.relation.causes": "导致",
  "story.relation.enables": "使之成为可能",
  "story.relation.blocks": "阻碍",
  "story.relation.reveals": "揭示",
  "story.relation.conflicts_with": "冲突",
  "story.relation.depends_on": "依赖",
  "story.relation.missing": "关系暂未核全",
  "story.connection.cognition":
    "{subject} → {target} · {state} · 人工声明顺序 {order}",
  "story.subject.audience": "观众（{id}）",
  "story.subject.missing": "原认知主体类型未核全",
  "story.target.missing": "原认知对象未核全",
  "story.knowledge.unknown": "未知",
  "story.knowledge.suspects": "怀疑",
  "story.knowledge.misbelieves": "误信",
  "story.knowledge.knows": "知晓",
  "story.knowledge.missing": "认知状态未核全",
  "story.order.missing": "未记录",
  "story.connection.node": "来源锚定节点（不是自动提取或语义认证）",
  "story.eligible": "当前正式采用（不是语义认证）",
  "story.ineligible": "AI 草稿／失效／历史，不作当前正式输入",
  "story.separator": "；",

  "picker.title.next": "下一章来源范围",
  "picker.title.prior": "本轮前文来源",
  "picker.summary": "{title} · 明确选择 {count} 章",
  "picker.summary.summaries": " + {count} 条高层摘要",
  "picker.summary.story": " + {count} 条叙事解释",
  "picker.note.quality":
    "只使用本轮确认范围的实际表达；每章须直接选择原文/章节摘要/段落，或由明确高层摘要覆盖。",
  "picker.note.next":
    "续章默认只承接当前章完整原文；可在启动前明确改选摘要、段落或其他前文。",
  "picker.note.prior": "本章原文会冻结。",
  "picker.note":
    "未选前文不自动纳入，不取固定前几章或旧摘要；摘要不是原文或语义保证。原章节禁止外发时，摘要与片段同样不能发送。",
  "picker.scope.quality": "本轮范围",
  "picker.scope.prior": "当前前文",
  "picker.budget":
    "{scope} {total} 章，未选 {unselected} 章没有直接表达；高层摘要的实际覆盖另行列明，不重复计算。这里只是预算估算，生成时还会核对实际冻结结果；不静默裁剪。",
  "picker.higher.label": "小说高层摘要来源",
  "picker.higher.note":
    "可明确选择已采用的卷／故事弧／全书冻结范围摘要，并搭配所选原文或段落。",
  "picker.higher.note.quality":
    "摘要全部覆盖章节必须位于本轮确认范围，不能拆掉范围外章节。",
  "picker.higher.note.prior":
    "必须全部来自当前目标之前的章节；不会截掉摘要中的后文。",
  "picker.higher.note.inherit":
    "新增目录不扩大旧摘要范围，源变化或采用换头须重新选择；完整原文和中间摘要的禁止外发均继承。",
  "picker.higher.read": "读取卷／故事弧／全书采用头",
  "picker.higher.failed": "高层摘要未核全：{message}",
  "picker.higher.none":
    "没有实际采用摘要；生成 AI 草稿和目录节点不升级为来源。",
  "picker.higher.previous": "先前所选冻结范围",
  "picker.higher.mismatch": "实际摘要目录项目无法核对。",
  "picker.empty.production":
    "请先明确选择制作范围，不自动补入原文或摘要；不使用正文须另行确认。",
  "picker.empty.planning":
    "请先明确选择规划范围，不自动补入原文或摘要；无正文规划可另行明确确认。",
  "picker.empty.quality": "请先明确选择质量范围，不自动补入原文或摘要。",
  "picker.empty.prior": "当前章节之前没有正文目录，不制造前文占位。",

  "higher.label": "高层摘要来源 {title}",
  "higher.legend": "{title} · 采用范围快照",
  "higher.read": "读取此摘要的冻结范围",
  "higher.include.label": "纳入高层摘要 {id}",
  "higher.include": "纳入本轮摘要（不自动纳入原文）",
  "higher.meta":
    "冻结 {count} 章；摘要 v{version}{selected}；文字估算 {tokens} token；实际冻结还含引用标识，usage／费用未知。",
  "higher.meta.selected": "／本轮所选 v{version}",
  "higher.stale":
    "当前完整范围已变化；这里只可使用原冻结范围，不声称覆盖当前整卷或全书。",
  "higher.notPrior": "含当前章、后文或旧版本，不能拆掉部分摘要使用。",
  "higher.notEligible": "不是当前来源有效的所选采用头，请清除并重新明确选择。",
  "higher.chapters": "此摘要的实际章节版本",
  "higher.chapter": "{id} v{version}",
  "higher.mismatch": "实际摘要项目或身份无法核对。",

  "chapter.label": "前文来源 {title}",
  "chapter.legend": "{title} · 当前正文版本 {version}",
  "chapter.select": "前文表达 {title}",
  "chapter.none": "不纳入本轮",
  "chapter.original": "完整原文 · 估算 {tokens} token",
  "chapter.paragraphs": "明确原文段落（不代表整章）",
  "chapter.summary": "已采用摘要 · {text}",
  "chapter.summary.previous": "先前所选摘要 · 当前未核验",
  "chapter.read": "读取此章摘要和段落",
  "chapter.version": "本轮所选正文版本 {version}；不会自动换成新版本。",
  "chapter.old": "选择已失效，请清除后明确重新选择。",
  "chapter.failed":
    "来源索引未核全：{message}。仍可明确选择完整原文，不使用未知摘要。",
  "chapter.summary.text":
    "派生摘要：{text} · 估算 {tokens} token；采用记录 {id}，不是文学质量保证。",
  "chapter.paragraphs.note":
    "明确勾选实际段落；偏移按此版本 UTF-16，结束位置不含在内。",
  "chapter.paragraph.label": "上下文段落 {title} {start}",
  "chapter.paragraph": "[{start}, {end}) · {text}",
  "chapter.paragraphs.required": "至少明确选择一个原文段落后才能生成。",
  "chapter.clear": "清除此章来源选择",
  "chapter.mismatch": "实际章节索引项目、身份或版本无法核对。",

  "sources.label": "来源锚定叙事索引",
  "sources.title": "人物／事件、因果关系与认知声明",
  "sources.note":
    "这是来源锚定的作者解释目录，不是模型语义认证。AI 草稿、过期与撤回历史保留；旧手工图仍单独维护，不自动升级。章节／卷／故事弧归属沿当前目录核对，不把声明数量当作全书质量或阅读覆盖。",
  "sources.note.select":
    "只有勾选的当前正式声明才进入本轮输入：声明文本、实际端点名称／版本和来源身份；不附带冻结引文、原文或端点摘要。原章、段落、中间资料和声明自身的禁止策略均继承。每条声明的全部来源须在本轮允许范围；不扩大原文／摘要覆盖。",
  "sources.read": "读取人物／因果／认知来源目录",
  "sources.failed": "叙事索引未完整核对：{message}；旧缓存不作为本次选择依据。",
  "sources.loading": "正在读取当前 owner 目录，未计为已检查。",
  "sources.filter": "目录关联筛选（只改变展示）",
  "sources.filter.label": "叙事目录层级筛选",
  "sources.filter.all": "全部原声明（含无章节的剧本来源）",
  "sources.filter.unverified": "{label}（原范围未核全，不猜测匹配）",
  "sources.filter.lost": "原筛选层级当前未核对，请明确切回全部",
  "sources.view": "结构展示",
  "sources.view.label": "叙事索引结构展示",
  "sources.view.all": "全部声明",
  "sources.view.nodes": "人物／事件等节点",
  "sources.view.relationship": "关系与因果方向",
  "sources.view.cognition": "认知声明（按人工顺序）",
  "sources.filter.note":
    "层级筛选只查找至少一个当前版本来源的目录关联，不表示整条跨章关系局限在此范围；每条的全部原来源仍显示，不改变本轮已选声明或允许章节。",
  "sources.filter.stale":
    "原筛选层级已失效或不可核对，未换成另一个卷／故事弧。请明确切回全部或选择当前层级。",
  "sources.hidden":
    "当前展示筛选外仍有 {count} 个原选择，未自动移除或替换；切回全部可逐项审阅。本轮输入仍按全部实际来源核对。",
  "sources.fingerprint":
    "当前目录指纹 {fingerprint} · 本范围 {count} 条声明；不是原著覆盖率。",
  "sources.entry": "{title} · {classification} · v{version}",
  "sources.entry.state": "{status} · 原来源{source} · {retirement}",
  "sources.status.adopted": "已明确采用",
  "sources.status.pending": "AI 草稿，未采用",
  "sources.status.discarded": "已放弃",
  "sources.source.current": "当前可核对",
  "sources.source.stale": "已失效",
  "sources.source.unavailable": "不可核对",
  "sources.retirement.withdrawn": "已撤回",
  "sources.retirement.replaced": "已被替换，保留原声明",
  "sources.retirement.eligible": "实际采用绑定有效（不是语义通过）",
  "sources.retirement.ineligible": "不能作为当前正式上下文",
  "sources.endpoints": "实际端点：{list}",
  "sources.order":
    "认知声明顺序 {order} · 状态 {state}；这是人工声明顺序，不冒充正文时间线。",
  "sources.interpretation.author-inferred": "作者推断，不升级为原文事实",
  "sources.interpretation.source-stated": "作者声明原文有陈述，仍未语义认证",
  "sources.interpretation.author-declared": "作者声明，不是原文语义证明",
  "sources.counts": "{interpretation} · 来源 {chapters} 章／{scripts} 份剧本",
  "sources.exact": "精确来源与采用身份",
  "sources.exact.selection": "原声明 {id} v{version} · {fingerprint}",
  "sources.exact.record": "实际 {kind} {id} v{version}",
  "sources.exact.chapter": "章节 {id} v{version}",
  "sources.exact.script": "剧本 {id} v{version}",
  "sources.include.label": "纳入叙事声明 {id}",
  "sources.include": "纳入本轮解释（不附带原文）",
  "sources.old":
    "原选择 v{old} 已失效，未自动改为 v{current}；请移除后重新选择。",
  "sources.empty": "本范围没有来源锚定声明；不据此认定没有故事内容或旧手工图。",
  "sources.missing":
    "原所选 {kind} {id} v{version} 当前未核对；未切换最近声明。",
  "sources.remove": "移除此原选择",
  "sources.mismatch": "叙事索引项目或身份不符，未显示其他项目或重复声明。",

  "timeline.label": "来源事件时间线",
  "timeline.note":
    "仅按原事件声明的故事时间标注排列，不从章节／剧本块目录、人物认知顺序或因果边推断时间。相同顺序只并列；未标注事件保留，不补时间，不代表全书完整事件覆盖。AI 草稿／失效／撤回历史不作为当前正式输入。",
  "timeline.column.event": "原事件与状态",
  "timeline.column.time": "作者时间标注",
  "timeline.column.origin": "完整原来源",
  "timeline.entry": "{title} · 原声明 {id} v{version} · {state}",
  "timeline.none": "时间未标注，不推断先后",
  "timeline.text": "事件故事时间顺序 {order} · {label} · {interpretation}",
  "timeline.interpretation.source-stated": "作者声明原文有陈述（不是语义认证）",
  "timeline.interpretation.author-inferred": "作者推断（不升级为原文事实）",

  "hierarchy.unavailable":
    "当前章节／卷／故事弧归属未完整核对，不沿旧缓存分组，不认定为空范围；原声明与原参考内容保留。",
  "hierarchy.title": "当前全书／卷／显式故事弧目录",
  "hierarchy.note":
    "这是当前目录归属，不是原声明冻结时的归属或模型阅读覆盖。未绑定／失效故事弧保留原身份，不猜测起止章号。",
  "hierarchy.group": "{label} · {state} · {count} 个目录引用（不是阅读覆盖）",
  "hierarchy.state.current": "当前目录",
  "hierarchy.state.stale": "原范围失效",
  "hierarchy.state.unbound": "未绑定实际章节",
  "hierarchy.chapter": "{title} · 当前目录 v{version} · {id}",
  "hierarchy.chapter.missing": "当前章节缺失 · {id}",
  "hierarchy.chapter.oldArc": "{chapter}；旧弧不绑定此当前版本",
  "hierarchy.empty": "没有实际章节绑定，不推断不存在故事内容。",

  "origin.chapter": "原章节 {title} v{version}（{id}） · {state}",
  "origin.current": "当前目录关联：{groups}",
  "origin.ungrouped": "未归属卷／故事弧",
  "origin.stale": "当前目录已为 v{version}，未把旧源重绑当前卷／故事弧",
  "origin.missing": "当前目录缺失，保留原来源",
  "origin.unavailable": "当前层级不可核对，保留原来源",
  "origin.script": "原剧本 {id} v{version}；不强制转换为小说章节或全书归属。",
  "origin.none": "原来源未核全，不推断全书覆盖。",

  "structure.label": "来源关系与认知结构表",
  "structure.note":
    "方向来自作者声明；人工认知顺序不是正文时间线或已认证的因果结论。各行保留全部跨章／跨卷来源。",
  "structure.column.entry": "原声明与状态",
  "structure.column.connection": "关系方向／认知主体与对象",
  "structure.column.origin": "完整原来源与当前目录关联",
  "structure.entry": "{title} v{version}",
};

export const en: Record<keyof typeof zh, string> = {
  "story.group": "{kind}: {title} v{version}",
  "story.group.book": "Book",
  "story.group.volume": "Volume",
  "story.group.story-arc": "Story arc",
  "story.reason.project": "The declaration belongs to another project.",
  "story.reason.unverified":
    "The declaration has not passed a check against its actual sources.",
  "story.reason.script":
    "It has script sources and cannot silently enter this round's novel chapters.",
  "story.reason.noChapter":
    "It has no chapter source in this round and is not used as source context.",
  "story.reason.scope":
    "It cites an unconfirmed range, the current or a later chapter, or an old chapter version; its sources cannot be partly cut away.",
  "story.endpoint": "{title} v{version} ({id})",
  "story.endpoint.missing": "Endpoint not yet fully checked",
  "story.connection.relationship": "{from} → {relation} → {to}",
  "story.relation.causes": "causes",
  "story.relation.enables": "enables",
  "story.relation.blocks": "blocks",
  "story.relation.reveals": "reveals",
  "story.relation.conflicts_with": "conflicts with",
  "story.relation.depends_on": "depends on",
  "story.relation.missing": "relation not yet fully checked",
  "story.connection.cognition":
    "{subject} → {target} · {state} · declared order {order}",
  "story.subject.audience": "Audience ({id})",
  "story.subject.missing": "Cognition subject kind not fully checked",
  "story.target.missing": "Cognition target not fully checked",
  "story.knowledge.unknown": "unknown",
  "story.knowledge.suspects": "suspects",
  "story.knowledge.misbelieves": "misbelieves",
  "story.knowledge.knows": "knows",
  "story.knowledge.missing": "cognition state not fully checked",
  "story.order.missing": "not recorded",
  "story.connection.node":
    "Source-anchored node (not automatic extraction or semantic certification)",
  "story.eligible": "Currently adopted (not semantic certification)",
  "story.ineligible": "AI draft, stale or history; not current formal input",
  "story.separator": "; ",

  "picker.title.next": "Sources for the next chapter",
  "picker.title.prior": "Prior text for this round",
  "picker.summary": "{title} · {count} chapters chosen",
  "picker.summary.summaries": " + {count} higher summaries",
  "picker.summary.story": " + {count} narrative interpretations",
  "picker.note.quality":
    "Only the actual expression of this round's confirmed range is used; each chapter needs its text, chapter summary or paragraphs chosen directly, or an explicit higher summary covering it.",
  "picker.note.next":
    "A continuation takes only the full text of the current chapter by default; choose summaries, paragraphs or other prior text before starting.",
  "picker.note.prior": "This chapter's text is frozen.",
  "picker.note":
    " Prior text you do not choose is not included, and no fixed first chapters or old summaries are taken; a summary is not the text or a semantic guarantee. When a chapter may not be sent out, neither may its summaries or excerpts.",
  "picker.scope.quality": "This round's range",
  "picker.scope.prior": "Prior text",
  "picker.budget":
    "{scope}: {total} chapters, {unselected} not chosen have no direct expression; the actual coverage of higher summaries is listed separately and not counted twice. This is only a budget estimate; the actual frozen result is checked again when generating, and nothing is silently trimmed.",
  "picker.higher.label": "Higher novel summary sources",
  "picker.higher.note":
    "You can explicitly choose adopted frozen-range summaries of a volume, story arc or the book, together with the chosen text or paragraphs.",
  "picker.higher.note.quality":
    " Every chapter a summary covers must lie in this round's confirmed range; chapters outside it cannot be cut away.",
  "picker.higher.note.prior":
    " They must all come from chapters before the current target; later text in a summary is not cut away.",
  "picker.higher.note.inherit":
    " New directory entries do not widen an old summary's range; a source change or a new adopted head needs a new choice. Send-out bans on full text and intermediate summaries are inherited.",
  "picker.higher.read": "Read volume, story arc and book heads",
  "picker.higher.failed": "Higher summaries not fully checked: {message}",
  "picker.higher.none":
    "No summary is actually adopted; AI drafts and directory nodes are not promoted to sources.",
  "picker.higher.previous": "Previously chosen frozen range",
  "picker.higher.mismatch":
    "The summary directory's project could not be checked.",
  "picker.empty.production":
    "Choose the production range first; no text or summary is added automatically, and going without text needs its own confirmation.",
  "picker.empty.planning":
    "Choose the planning range first; no text or summary is added automatically, and planning without text can be confirmed separately.",
  "picker.empty.quality":
    "Choose the quality range first; no text or summary is added automatically.",
  "picker.empty.prior":
    "There is no text before the current chapter; no placeholder prior text is made.",

  "higher.label": "Higher summary source {title}",
  "higher.legend": "{title} · adopted range snapshot",
  "higher.read": "Read this summary's frozen range",
  "higher.include.label": "Include higher summary {id}",
  "higher.include": "Include this summary (text is not included)",
  "higher.meta":
    "{count} chapters frozen; summary v{version}{selected}; text estimate {tokens} tokens; the frozen input also carries citation ids, usage and cost unknown.",
  "higher.meta.selected": " / chosen v{version}",
  "higher.stale":
    "The full current range has changed; only the original frozen range can be used here, without claiming the whole current volume or book.",
  "higher.notPrior":
    "It includes the current chapter, later text or an old version; part of a summary cannot be cut away.",
  "higher.notEligible":
    "It is not a currently valid chosen adopted head; clear it and choose again.",
  "higher.chapters": "Actual chapter versions of this summary",
  "higher.chapter": "{id} v{version}",
  "higher.mismatch": "The summary's project or identity could not be checked.",

  "chapter.label": "Prior source {title}",
  "chapter.legend": "{title} · current text version {version}",
  "chapter.select": "Prior expression {title}",
  "chapter.none": "Not included",
  "chapter.original": "Full text · about {tokens} tokens",
  "chapter.paragraphs": "Chosen paragraphs (not the whole chapter)",
  "chapter.summary": "Adopted summary · {text}",
  "chapter.summary.previous": "Previously chosen summary · not verified now",
  "chapter.read": "Read this chapter's summaries and paragraphs",
  "chapter.version":
    "Chosen text version {version}; it is not switched to a newer version.",
  "chapter.old": "The choice is stale; clear it and choose again.",
  "chapter.failed":
    "Source index not fully checked: {message}. You can still choose the full text; unknown summaries are not used.",
  "chapter.summary.text":
    "Derived summary: {text} · about {tokens} tokens; adoption record {id}, not a guarantee of literary quality.",
  "chapter.paragraphs.note":
    "Tick the actual paragraphs; offsets are UTF-16 in this version, end exclusive.",
  "chapter.paragraph.label": "Context paragraph {title} {start}",
  "chapter.paragraph": "[{start}, {end}) · {text}",
  "chapter.paragraphs.required":
    "Choose at least one paragraph before generating.",
  "chapter.clear": "Clear this chapter's choice",
  "chapter.mismatch":
    "The chapter index's project, identity or version could not be checked.",

  "sources.label": "Source-anchored narrative index",
  "sources.title": "Characters, events, causality and cognition declarations",
  "sources.note":
    "This is a source-anchored directory of author interpretations, not model semantic certification. AI drafts, stale and withdrawn history are kept; old hand-made graphs stay separate and are not promoted. Chapter, volume and story arc membership follows the current directory, and declaration counts are not book quality or reading coverage.",
  "sources.note.select":
    "Only ticked current formal declarations enter this round: the statement, the actual endpoint names and versions, and the source identities; no frozen quotes, text or endpoint summaries. Bans on the chapters, paragraphs, intermediate material and the declaration itself are inherited. All sources of a declaration must lie in this round's allowed range; text and summary coverage is not widened.",
  "sources.read": "Read the character, causality and cognition directory",
  "sources.failed":
    "Narrative index not fully checked: {message}; an old cache is not used for this choice.",
  "sources.loading":
    "Reading the current owner directory; not counted as checked.",
  "sources.filter": "Directory filter (display only)",
  "sources.filter.label": "Narrative directory level filter",
  "sources.filter.all":
    "All declarations (including script sources without chapters)",
  "sources.filter.unverified": "{label} (range not fully checked; no guessing)",
  "sources.filter.lost":
    "The original filter level is not checked now; switch back to all",
  "sources.view": "Structure",
  "sources.view.label": "Narrative index structure view",
  "sources.view.all": "All declarations",
  "sources.view.nodes": "Characters, events and other nodes",
  "sources.view.relationship": "Relationships and causal direction",
  "sources.view.cognition": "Cognition declarations (declared order)",
  "sources.filter.note":
    "A level filter only finds directory links of at least one current-version source; it does not mean a cross-chapter relation is confined to this range. All original sources still show, and neither the chosen declarations nor the allowed chapters change.",
  "sources.filter.stale":
    "The original filter level is stale or cannot be checked and was not swapped for another volume or story arc. Switch back to all or choose a current level.",
  "sources.hidden":
    "{count} original choices are outside the current filter and were not removed or replaced; switch back to all to review them. This round's input is still checked against all actual sources.",
  "sources.fingerprint":
    "Directory fingerprint {fingerprint} · {count} declarations in range; not source coverage.",
  "sources.entry": "{title} · {classification} · v{version}",
  "sources.entry.state": "{status} · source {source} · {retirement}",
  "sources.status.adopted": "Adopted",
  "sources.status.pending": "AI draft, not adopted",
  "sources.status.discarded": "Discarded",
  "sources.source.current": "currently checkable",
  "sources.source.stale": "stale",
  "sources.source.unavailable": "not checkable",
  "sources.retirement.withdrawn": "Withdrawn",
  "sources.retirement.replaced": "Replaced; the original is kept",
  "sources.retirement.eligible": "Adoption binding valid (not a semantic pass)",
  "sources.retirement.ineligible": "Not usable as current formal context",
  "sources.endpoints": "Endpoints: {list}",
  "sources.order":
    "Declared cognition order {order} · state {state}; a human-declared order, not the story timeline.",
  "sources.interpretation.author-inferred":
    "Author inference, not promoted to source fact",
  "sources.interpretation.source-stated":
    "Author says the text states it; not semantically certified",
  "sources.interpretation.author-declared":
    "Author declaration, not semantic proof",
  "sources.counts":
    "{interpretation} · sources {chapters} chapters / {scripts} scripts",
  "sources.exact": "Exact sources and adoption identity",
  "sources.exact.selection": "Declaration {id} v{version} · {fingerprint}",
  "sources.exact.record": "Actual {kind} {id} v{version}",
  "sources.exact.chapter": "Chapter {id} v{version}",
  "sources.exact.script": "Script {id} v{version}",
  "sources.include.label": "Include narrative declaration {id}",
  "sources.include": "Include this interpretation (no text)",
  "sources.old":
    "Original choice v{old} is stale and was not switched to v{current}; remove it and choose again.",
  "sources.empty":
    "No source-anchored declarations in this range; this does not mean there is no story content or old graph.",
  "sources.missing":
    "Chosen {kind} {id} v{version} is not checked now; no nearest declaration was substituted.",
  "sources.remove": "Remove this choice",
  "sources.mismatch":
    "The narrative index's project or identities do not match; other projects or duplicate declarations are not shown.",

  "timeline.label": "Source event timeline",
  "timeline.note":
    "Ordered only by the story time annotations of event declarations; no time is inferred from chapter or script block order, cognition order or causal edges. Equal orders stand side by side; unannotated events are kept without a time, and this is not complete event coverage. AI drafts, stale and withdrawn history are not current formal input.",
  "timeline.column.event": "Event and state",
  "timeline.column.time": "Author time annotation",
  "timeline.column.origin": "All original sources",
  "timeline.entry": "{title} · declaration {id} v{version} · {state}",
  "timeline.none": "No time annotated; no order inferred",
  "timeline.text": "Story time order {order} · {label} · {interpretation}",
  "timeline.interpretation.source-stated":
    "Author says the text states it (not semantic certification)",
  "timeline.interpretation.author-inferred":
    "Author inference (not promoted to source fact)",

  "hierarchy.unavailable":
    "Current chapter, volume and story arc membership is not fully checked; no old cached grouping is used and the range is not taken as empty. Original declarations and references are kept.",
  "hierarchy.title": "Current book, volume and explicit story arc directory",
  "hierarchy.note":
    "This is the current directory membership, not the membership when a declaration was frozen or model reading coverage. Unbound or stale story arcs keep their identity; no start or end chapter is guessed.",
  "hierarchy.group":
    "{label} · {state} · {count} directory references (not reading coverage)",
  "hierarchy.state.current": "current directory",
  "hierarchy.state.stale": "range stale",
  "hierarchy.state.unbound": "no chapters bound",
  "hierarchy.chapter": "{title} · current directory v{version} · {id}",
  "hierarchy.chapter.missing": "Current chapter missing · {id}",
  "hierarchy.chapter.oldArc":
    "{chapter}; the old arc is not bound to this current version",
  "hierarchy.empty":
    "No chapters are bound; this does not mean there is no story content.",

  "origin.chapter": "Chapter {title} v{version} ({id}) · {state}",
  "origin.current": "current directory: {groups}",
  "origin.ungrouped": "no volume or story arc",
  "origin.stale":
    "the directory is now v{version}; the old source is not rebound to the current volume or arc",
  "origin.missing": "missing from the current directory; the source is kept",
  "origin.unavailable": "levels cannot be checked now; the source is kept",
  "origin.script":
    "Script {id} v{version}; not converted to novel chapters or book membership.",
  "origin.none": "Sources not fully checked; no book coverage is inferred.",

  "structure.label": "Source relationship and cognition table",
  "structure.note":
    "Directions come from author declarations; a declared cognition order is not the story timeline or a certified causal conclusion. Each row keeps all its cross-chapter and cross-volume sources.",
  "structure.column.entry": "Declaration and state",
  "structure.column.connection":
    "Relation direction / cognition subject and target",
  "structure.column.origin": "All sources and current directory links",
  "structure.entry": "{title} v{version}",
};
