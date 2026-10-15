import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BareButton, Disclosure } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";
import { SourceConfirmations } from "./SourceConfirmations";
import { PlanningOutcomes } from "./PlanningOutcomes";
import { CreativeExecutions } from "./CreativeExecutions";
import { CreativeConfigurationFunnelPanel } from "./CreativeConfigurationFunnel";
import { NovelRevisionEffortPanel } from "./NovelRevisionEffort";
import { CreativeDeliveryCoveragePanel } from "./CreativeDeliveryCoverage";

const labels = {
  "novel.chapter-adopted": "正式章节采用版本",
  "novel.planning-adopted": "人物 / 大纲 / 故事弧采用版本",
  "novel.chapter-memory-written": "章节派生记忆实际写入批次",
  "novel.manuscript-exported": "已保存的稿件版本集合",
  "adaptation.diagnosis-adopted": "诊断采用版本",
  "adaptation.strategy-adopted": "独立改编策略明确单选版本",
  "adaptation.season-plan-adopted": "季纲采用版本",
  "adaptation.script-adopted": "标准剧本采用版本",
  "adaptation.pilot-package-exported": "已保存的内部试制包版本集合",
} as const;
const metricLabels = {
  "novel.chapter": "小说章节",
  "adaptation.diagnosis": "改编诊断",
  "adaptation.strategy": "独立改编策略",
  "adaptation.season-plan": "整季方案",
  "adaptation.script": "标准分集剧本",
} as const;
const duration = (ms: number | null) =>
  ms === null ? "未知（时钟异常）" : `${(ms / 1000).toFixed(1)} 秒`;
const continuationStates = {
  unobserved: "未建立观察窗（历史证据不足）",
  pending: "七天待观察",
  continued: "满窗：已真实启动续接",
  "not-started": "满窗：未记录窗内启动",
  "clock-inconsistent": "时钟证据异常，不进入继续率",
} as const;

function ChapterCollectionEvidence({
  frozenIds,
  currentIds,
}: {
  frozenIds: readonly string[];
  currentIds: readonly string[];
}) {
  const added = currentIds.filter((id) => !frozenIds.includes(id));
  const left = frozenIds.filter((id) => !currentIds.includes(id));
  return (
    <section aria-label="全书章节集合变化证据" className="space-y-1">
      <p>
        Writing 全书非空章节完整目录：冻结 {frozenIds.length} 项 → 实际核对{" "}
        {currentIds.length} 项（不是目录版本）
      </p>
      <p>进入该范围的章节引用：{added.join("、") || "无"}</p>
      <p>退出该范围的章节引用：{left.join("、") || "无"}</p>
      <p>
        仅是拒绝时的完整目录观察；空正文可退出范围，不等于物理删除、已读正文、当前授权或叙事质量。
      </p>
    </section>
  );
}

/** Mount with a project key: no old project ledger survives a scope switch. */
export function CreativeOutcomesPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const continuation = useQuery({
    queryKey: ["creative-continuations-summary"],
    queryFn: ({ signal }) =>
      client.creativeOutcomes.continuationSummary(signal),
  });
  const summary = useQuery({
    queryKey: ["creative-outcomes-summary", projectId],
    queryFn: ({ signal }) => client.creativeOutcomes.summary(projectId, signal),
  });
  const events = useInfiniteQuery({
    queryKey: ["creative-outcomes", projectId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.creativeOutcomes.list(projectId, pageParam, 25, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  const error = summary.error ?? events.error ?? continuation.error;
  return (
    <section
      aria-label="本地创作结果台账"
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">本地创作结果台账</h2>
        <BareButton
          className="text-sm text-brand disabled:opacity-50"
          disabled={
            summary.isFetching || events.isFetching || continuation.isFetching
          }
          onClick={() => {
            void summary.refetch();
            void events.refetch();
            void continuation.refetch();
          }}
        >
          刷新结果台账
        </BareButton>
      </div>
      <p className="text-sm text-muted">
        只统计你正式采用、写入记忆和保存的成果；数据只在本机，不外发。
      </p>
      <Disclosure summary="统计口径说明" summaryClassName="text-xs text-muted">
        <div className="space-y-2">
          <p className="text-sm text-muted">
            分别统计正式采用、章节派生记忆实际写入与完整性回执匹配的实际保存。小说与剧本分开计数，同一实际版本集合的重放、重复保存、换格式或重试不会增加成果数；AI
            草稿和页面点击不计入。
          </p>
          <p className="text-sm text-muted">
            这是本地历史事实，不是当前版本质量、版权核验或爆款预测。仅包含开始记录后的权威事件，不补算旧资料；不会发送正文、提示词或台账到外部分析服务。
          </p>
          <p className="text-xs text-muted">
            记忆写入按实际记录集合计一批，不计入人工正文采用或首稿采用率；自动同步与独立审阅的流程仍各自保留，此计数不认证触发方式、当前有效性或语义正确性。
          </p>
        </div>
      </Disclosure>
      <CreativeExecutions key={projectId} projectId={projectId} />
      <CreativeDeliveryCoveragePanel
        key={`delivery:${projectId}`}
        projectId={projectId}
      />
      <NovelRevisionEffortPanel
        key={`revisions:${projectId}`}
        projectId={projectId}
      />
      <CreativeConfigurationFunnelPanel
        key={`configuration:${projectId}`}
        projectId={projectId}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          结果台账读取失败：{message(error)}。不能把读取失败当成没有成果。
        </p>
      )}
      {summary.isPending && (
        <p className="text-sm text-muted">正在读取本地结果台账…</p>
      )}
      {summary.data && !error && (
        <>
          {summary.data.projection.state !== "healthy" && (
            <p role="status" className="text-sm text-warning">
              结果投影尚未追平或读取异常，当前数字可能不完整；请稍后刷新。
            </p>
          )}
          {summary.data.goalConfirmations.recordedProjects > 0 && (
            <section
              aria-label="初始创作目标确认"
              className="space-y-2 rounded-lg border border-line p-3 text-sm"
            >
              <h3 className="font-medium">初始创作目标确认</h3>
              {summary.data.goalConfirmations.items.map((goal) => (
                <div
                  key={goal.eventId}
                  data-initial-goal-project-id={goal.projectId}
                >
                  <p>
                    创建时明确目标：
                    {goal.goal === "novel-first"
                      ? "先完成小说"
                      : "先完成剧本"}{" "}
                    · 素材：
                    {goal.material === "inspiration"
                      ? "创意"
                      : goal.material === "source-import"
                        ? "小说 / 大纲"
                        : "已有剧本"}
                  </p>
                  <p>
                    原项目 {goal.projectId} @ {goal.projectVersion} · 确认发生于{" "}
                    {new Date(goal.occurredAt).toLocaleString()}
                  </p>
                </div>
              ))}
              <p className="text-xs text-muted">
                只描述实际创建请求的初始明确选择，不是当前作者意图、身份认证、授权证明或质量评分；模型来源未知。旧项目和默认推荐不补确认，不增加成果数或采用率分母。
              </p>
            </section>
          )}
          <SourceConfirmations value={summary.data.sourceConfirmations} />
          <PlanningOutcomes
            batches={summary.data.planningBatches}
            funnel={summary.data.planningFunnel}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {(["novel", "adaptation"] as const).map((path) => (
              <section
                key={path}
                className="space-y-2 rounded-lg border border-line p-3"
              >
                <h3 className="font-medium">
                  {path === "novel" ? "小说结果" : "剧本 / 改编结果"}
                </h3>
                {summary.data.counts
                  .filter((item) => item.kind.startsWith(`${path}.`))
                  .map((item) => (
                    <p
                      key={item.kind}
                      className="flex flex-wrap justify-between gap-2 text-sm"
                    >
                      <span>{labels[item.kind]}</span>
                      <span>
                        累计 {item.total} · 最近 7 天 {item.lastSevenDays}
                      </span>
                    </p>
                  ))}
              </section>
            ))}
          </div>
          <p className="text-xs text-muted">
            最近 7 天为滚动时间窗，以该成果首次权威回执计数，不是自然周。7
            天继续率单独使用固定满窗项目分母，不能与上述滚动成果数混用。真实模型用量与成本、叙事质量率暂不计算。模型来源未知，不由引擎名推断；人工采用与规则校验不等于真实模型质量证据。
          </p>
          {summary.data.qualityAssociations.recordedReports > 0 && (
            <section
              aria-label="质量报告历史关联"
              className="space-y-2 rounded-lg border border-line p-3 text-sm"
            >
              <h3 className="font-medium">质量报告历史关联</h3>
              <p>
                已记录报告采用{" "}
                {summary.data.qualityAssociations.recordedReports} ·
                精确目标关联{" "}
                {summary.data.qualityAssociations.reportsWithExactTarget} ·
                明确跨章范围关联{" "}
                {summary.data.qualityAssociations.reportsWithScopeMembers} ·
                未关联已记录成果{" "}
                {summary.data.qualityAssociations.reportsWithoutRecordedOutcome}
              </p>
              <p className="text-xs text-muted">
                只读开始记录后的报告采用凭证及准确历史版本，不补算旧报告。报告采用、人工接受风险或解决问题均不等于文学质量通过；模型来源、当前报告有效性和叙事质量仍未知。跨章范围成员不等于逐章原文已读，不作为质量率分母。普通保存剧本／场景的不同身份与指纹不近似映射为单集成果。
              </p>
              <p className="text-xs text-muted">
                关联成果单位{" "}
                {summary.data.qualityAssociations.linkedResultUnits}
                ；一份报告可关联多个历史成果，一份成果也可有关联的多份报告，两者不相加为成果或质量分。以下最多显示最近
                20 份已记录报告采用。
              </p>
              {summary.data.qualityAssociations.items.map((report) => (
                <details
                  key={report.report.id}
                  className="rounded border border-line p-2"
                  data-quality-adoption-report-id={report.report.id}
                >
                  <summary>
                    报告 {report.report.id} · 采用时版本 {report.report.version}{" "}
                    · 历史关联 {report.links.length}
                  </summary>
                  <p>
                    原工作流 {report.workflowId} · 原目标 {report.target.kind}：
                    {report.target.id} @ {report.target.version}
                  </p>
                  {report.target.sourceFingerprint && (
                    <p>原明确来源指纹 {report.target.sourceFingerprint}</p>
                  )}
                  <p>
                    原请求维度：{report.requestedDimensions.join("、")}
                    ；不是人工评分或质量通过。
                  </p>
                  {report.chapterScope && (
                    <div>
                      <p>
                        原明确
                        {report.chapterScope.mode === "full" ? "全书" : "选章"}
                        范围 {report.chapterScope.included.length} /{" "}
                        {report.chapterScope.nonEmptyChapterCount} 非空章（目录{" "}
                        {report.chapterScope.totalChapterCount} 章）
                      </p>
                      {report.chapterScope.included.map((chapter) => (
                        <p key={chapter.id}>
                          章节 {chapter.id} @ {chapter.version} · 表达{" "}
                          {chapter.representations.join("、")}
                        </p>
                      ))}
                    </div>
                  )}
                  {report.links.length ? (
                    report.links.map((link) => (
                      <p
                        key={`${link.unitKey}:${link.formalVersion.kind}:${link.formalVersion.id}`}
                      >
                        {link.relation === "exact-target-version"
                          ? "精确历史目标版本"
                          : "明确跨章范围成员（非逐章质量证明）"}
                        ：{labels[link.outcomeKind]} · {link.formalVersion.id} @{" "}
                        {link.formalVersion.version}
                      </p>
                    ))
                  ) : (
                    <p>
                      未找到准确的已记录成果关联；不表示没有报告、没有人工成果或质量不合格。
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    历史采用发生于{" "}
                    {new Date(report.occurredAt).toLocaleString()}
                    ；不读取正文，不更新原报告或当前正式头。
                  </p>
                </details>
              ))}
            </section>
          )}
          <section
            aria-label="本地七天续写观察"
            className="space-y-3 rounded-lg border border-line p-3"
          >
            <h3 className="font-medium">本地七天续写观察</h3>
            <p className="text-xs text-muted">
              当前项目以首个有完整记录的正式章节／实际第一集标准剧本固定七天观察窗。只认内容
              owner 的准确上一正式版本与紧邻下一目标、引擎接受的真实 run /
              session；请求和空目标不是启动。重复采用不重置窗口，后续失败不抹去已发生的启动，正式采用另计。缺失旧证据不补算为零。
            </p>
            {continuation.data?.projection.state !== "healthy" && (
              <p role="status" className="text-xs text-warning">
                全本地继续率投影尚未追平或尚未读取，数字可能不完整。
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {summary.data.continuation.observations.map((item) => {
                const cohort = continuation.data?.measures.find(
                  (value) => value.workflowPath === item.workflowPath,
                );
                return (
                  <section
                    key={item.workflowPath}
                    aria-label={`${item.workflowPath === "novel" ? "下一章" : "第二集"}七天观察`}
                    className="space-y-1 rounded border border-line p-3 text-sm"
                  >
                    <h4 className="font-medium">
                      {item.workflowPath === "novel"
                        ? "小说下一章"
                        : "剧本第二集"}
                    </h4>
                    <p>当前项目：{continuationStates[item.state]}</p>
                    {item.baseline && (
                      <p className="text-xs text-muted">
                        开始{" "}
                        {new Date(item.baseline.adoptedAt).toLocaleString()} ·
                        满窗 {new Date(item.baseline.deadline).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      请求 {item.recordedRequests} · 真实启动{" "}
                      {item.successfulStarts} · 后续正式目标{" "}
                      {item.nextAdoptedTargets} · 未关联本窗{" "}
                      {item.unlinkedRequests}
                    </p>
                    <p className="text-xs text-muted">
                      窗内启动：
                      {item.firstStarted
                        ? item.firstStarted.withinWindow
                          ? "已记录（未满窗仍待观察）"
                          : "窗外或时钟证据待核对"
                        : "尚未记录"}
                    </p>
                    {cohort ? (
                      <div className="text-xs text-muted">
                        <p>
                          全本地有记录项目（非当前项目分母）：满窗继续{" "}
                          {cohort.continuedProjects} / {cohort.maturedProjects}{" "}
                          · 七天继续率{" "}
                          {cohort.continuationRatio === null
                            ? "未建立满窗分母"
                            : `${(cohort.continuationRatio * 100).toFixed(1)}%`}
                        </p>
                        <p>
                          待观察 {cohort.pendingProjects}（其中已提前续接{" "}
                          {cohort.observedEarlyContinuations}）· 时钟未知{" "}
                          {cohort.clockUnknownProjects} · 无完整基线{" "}
                          {cohort.unobservedBaselineProjects}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">
                        全本地项目分母尚未读取，不显示为 0。
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            <p className="text-xs text-muted">
              每项目、每路各一个观察窗；小说不要求改编，直写剧本不要求小说。未满七天、来源不明与时钟异常不进入满窗分母。这是本地实际启动记录，不是公开留存率、叙事质量率或模型对比；不外发遥测。
            </p>
          </section>
          <section
            aria-label="本地首候选与采用耗时"
            className="space-y-3 rounded-lg border border-line p-3"
          >
            <h3 className="font-medium">本地首候选与采用耗时</h3>
            <Disclosure
              summary="统计口径说明"
              summaryClassName="text-xs text-muted"
            >
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  仅统计开始记录后的目标首个实际请求。重试、重新生成、人工合并不重置首轮；历史最初请求未记录的目标不进入首稿分母。占比是截至当前的本地记录，包含待决定，不是公开采用率、文学质量或受控／真实模型对比；当前运行分类均未知。
                </p>
                <p className="text-xs text-muted">
                  已核对来源冲突来自普通工作流拒绝，以及诊断、独立策略、季纲内容所有者已提交的拒绝；必须匹配原请求／AI
                  草稿回执并有实际来源身份、版本差异或完整全书非空章节集合增减，每个原
                  AI
                  草稿最多计一次，不是完整冲突率。缺资料、读取失败、仅目标竞争、未覆盖来源和不匹配原
                  AI 草稿的人工重排不补算；不证明当前有效性或文学质量。
                </p>
                <p className="text-xs text-muted">
                  采用被拒只统计已记录的工作流拒绝及匹配原 AI
                  草稿的内容所有者状态决定，重复
                  内容所有者回执不增加次数；不代表全部 HTTP
                  409、无效操作或所有历史拒绝。来源变化、目标竞争和未分类拒绝分别保留。
                </p>
              </div>
            </Disclosure>
            <div className="grid gap-3 md:grid-cols-2">
              {summary.data.funnel.measures.map((measure) => (
                <section
                  key={measure.metric}
                  aria-label={`${metricLabels[measure.metric]}首候选`}
                  className="space-y-1 rounded border border-line p-3 text-sm"
                >
                  <h4 className="font-medium">
                    {metricLabels[measure.metric]}
                  </h4>
                  <p>
                    {measure.metric === "adaptation.strategy"
                      ? "原首稿内明确选项采用"
                      : "原首稿直接采用"}{" "}
                    {measure.firstAdopted} / {measure.firstCandidates} ·
                    截至当前占比{" "}
                    {measure.firstCandidateAdoptionRatio === null
                      ? "未建立分母"
                      : `${(measure.firstCandidateAdoptionRatio * 100).toFixed(1)}%`}
                  </p>
                  <p className="text-xs text-muted">
                    待决定 {measure.pendingDecision} · 已结束未直接采用{" "}
                    {measure.closedWithoutFirstAdoption} · 改写后采用{" "}
                    {measure.revisedAdoption}
                  </p>
                  <p className="text-xs text-muted">
                    实际请求 {measure.recordedRequests} · 目标{" "}
                    {measure.requestedTargets} · 首轮历史缺失{" "}
                    {measure.unobservedFirstTargets} · 后续候选{" "}
                    {measure.retryCandidates} · 采用被拒{" "}
                    {measure.adoptionRejectedCount}
                  </p>
                  <p className="text-xs text-muted">
                    已核对来源冲突候选 {measure.sourceConflictCandidateCount}
                    （去重，非全部拒绝）
                  </p>
                  {measure.lastSourceConflict && (
                    <details
                      className="break-all text-xs text-muted"
                      data-source-conflict-workflow={
                        measure.lastSourceConflict.sourceConflict.workflowId
                      }
                    >
                      <summary className="cursor-pointer text-brand">
                        查看最近原 AI 草稿的来源变化证据
                      </summary>
                      <p>
                        原工作流{" "}
                        {measure.lastSourceConflict.sourceConflict.workflowId} ·
                        原候选 {measure.lastSourceConflict.candidate.id} ·
                        原候选 SHA{" "}
                        {
                          measure.lastSourceConflict.candidate
                            .contentFingerprint
                        }
                      </p>
                      {measure.lastSourceConflict.ownerRejection && (
                        <p>
                          专用拒绝所有者 production · 对象类型{" "}
                          {
                            measure.lastSourceConflict.ownerRejection
                              .aggregateType
                          }{" "}
                          · 决定状态版本{" "}
                          {
                            measure.lastSourceConflict.ownerRejection
                              .stateVersion
                          }
                          （不是内容或工作流版本）
                        </p>
                      )}
                      {measure.lastSourceConflict.sourceConflict.changes.map(
                        (change) => (
                          <p key={`${change.sourceKind}:${change.frozen.id}`}>
                            来源 {change.sourceKind} · 冻结 {change.frozen.id}@
                            {change.frozen.version} → 实际核对{" "}
                            {change.current.id}@{change.current.version}
                          </p>
                        ),
                      )}
                      {"chapterCollection" in
                        measure.lastSourceConflict.sourceConflict &&
                        measure.lastSourceConflict.sourceConflict
                          .chapterCollection && (
                          <ChapterCollectionEvidence
                            {...measure.lastSourceConflict.sourceConflict
                              .chapterCollection}
                          />
                        )}
                      <p>
                        历史拒绝发生于{" "}
                        {new Date(
                          measure.lastSourceConflict.occurredAt,
                        ).toLocaleString()}
                        ，不读取正文，不重新采用或认证当前来源。
                      </p>
                    </details>
                  )}
                  {measure.firstAccepted ? (
                    <div className="text-xs text-muted">
                      <p>
                        首个有记录的正式采用：
                        {measure.firstAccepted.adoptionMode ===
                        "selected-option"
                          ? `明确选项 ${measure.firstAccepted.selectedOption!.id}（非整包采用）`
                          : measure.firstAccepted.adoptionMode ===
                              "exact-candidate"
                            ? "原 AI 草稿"
                            : "改写 AI 草稿"}
                      </p>
                      <p>
                        请求至候选{" "}
                        {duration(measure.firstAccepted.requestToReadyMs)} ·
                        审阅至采用{" "}
                        {duration(measure.firstAccepted.readyToAdoptMs)} ·
                        请求至采用{" "}
                        {duration(measure.firstAccepted.requestToAdoptMs)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      尚无请求、AI 草稿与正式 owner
                      采用完整对应的耗时证据，不补为 0。
                    </p>
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-brand">
          查看不含正文的权威回执
        </summary>
        <ol className="mt-3 space-y-2">
          {!error &&
            events.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <li
                  key={item.eventId}
                  className="break-all rounded border border-line p-2 text-xs"
                >
                  <p>
                    {labels[item.kind]} ·{" "}
                    {item.resultStatus === "saved"
                      ? "实际保存 / 规则回执"
                      : item.resultStatus === "written"
                        ? "实际写入 / 原记录集合（非人工正文采用）"
                        : "正式采用 / 人工决定"}{" "}
                    · {new Date(item.occurredAt).toLocaleString()}
                  </p>
                  <p className="text-muted">
                    对象 {item.objectId} ·{" "}
                    {item.resultStatus === "written"
                      ? "实际记录版本"
                      : "正式版本"}{" "}
                    {item.formalVersions
                      .map((ref) => `${ref.kind}:${ref.id}@${ref.version}`)
                      .join("、")}
                  </p>
                  <p className="text-muted">
                    去重标识 {item.unitKey} · 模型来源未知 · 质量未独立验证
                  </p>
                  {item.selectedOption && (
                    <p className="text-muted">
                      明确选择 {item.selectedOption.id} · 原选项指纹{" "}
                      {item.selectedOption.contentFingerprint} ·
                      不是整包原样采用
                    </p>
                  )}
                  {item.memoryWrite && (
                    <p className="text-muted">
                      原章节 {item.memoryWrite.source.id}@
                      {item.memoryWrite.source.version} · 源指纹{" "}
                      {item.memoryWrite.source.contentFingerprint} · 实际写入{" "}
                      {item.memoryWrite.records.length} 条记录 ·
                      历史写入，不认证当前有效性
                    </p>
                  )}
                </li>
              ))}
        </ol>
        {events.data &&
          !events.data.pages.some((page) => page.items.length) && (
            <p className="mt-2 text-sm text-muted">
              当前尚无已记录的正式采用、记忆写入或保存回执；不代表旧项目从未有成果。
            </p>
          )}
        {events.hasNextPage && (
          <BareButton
            className="mt-3 text-sm text-brand disabled:opacity-50"
            disabled={events.isFetchingNextPage}
            onClick={() => void events.fetchNextPage()}
          >
            加载更多权威回执
          </BareButton>
        )}
      </details>
    </section>
  );
}
