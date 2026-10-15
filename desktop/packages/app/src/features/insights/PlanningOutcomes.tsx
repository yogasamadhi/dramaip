import type { CreativeOutcomeSummary } from "@dramaip/contracts/insights";

const labels = {
  characters: "人物方案",
  "book-outline": "全书大纲",
  "chapter-outline": "章节大纲",
  "story-arc": "故事弧",
  "knowledge-plan": "知识规划",
} as const;
const duration = (ms: number | null) =>
  ms === null ? "未知（时钟异常）" : `${(ms / 1000).toFixed(1)} 秒`;

/** Independent planning receipts only. Never infer them from current records. */
export function PlanningOutcomes({
  batches,
  funnel,
}: {
  batches: CreativeOutcomeSummary["planningBatches"];
  funnel: CreativeOutcomeSummary["planningFunnel"];
}) {
  // No planning activity: preserve the existing ledger layout. Missing older
  // service evidence still renders as unrecorded rather than fabricated zero.
  if (
    batches?.recordedBatches === 0 &&
    funnel?.unmatchedAdoptionBatches === 0 &&
    funnel.measures.every((item) => item.recordedRequests === 0)
  )
    return null;
  return (
    <section
      aria-label="独立故事规划批次与原请求"
      className="space-y-2 rounded-lg border border-line p-3 text-sm"
    >
      <h3 className="font-medium">独立故事规划批次与原请求</h3>
      <p>
        人物、大纲、故事弧与知识规划独立计量，不要求小说、改编或视频；多条实际资料只算一个采用批次。原逐条规划成果与本批次单位不同，不相加。
      </p>
      {!batches ? (
        <p>完整规划批次凭证未记录；旧服务缺失不代表零采用。</p>
      ) : (
        <>
          <p>
            本机已记录 {batches.recordedBatches} 个采用批次；显示最近{" "}
            {batches.items.length} 个，每批最多前 5 个实际记录引用及完整计数。
          </p>
          <p>
            {batches.counts
              .map(
                (row) =>
                  `${labels[row.operation]} ${row.batches} 批 / ${row.actualRecords} 条实际资料`,
              )
              .join(" · ")}
          </p>
          {batches.items.map((batch) => (
            <details
              key={batch.eventId}
              data-planning-batch-workflow-id={batch.fact.workflowId}
              className="rounded border border-line p-2 break-words"
            >
              <summary>
                {labels[batch.fact.operation]} · 完整采用{" "}
                {batch.fact.recordCount} 条 · {batch.owner}
              </summary>
              <p>
                原工作流 {batch.fact.workflowId} · 原候选{" "}
                {batch.fact.candidate.id}
              </p>
              <p>
                实际采用材料 SHA-256：{batch.fact.candidate.contentFingerprint}
              </p>
              <p>
                首次提交 {new Date(batch.occurredAt).toLocaleString()} · 原事件{" "}
                {batch.eventId}
              </p>
              {batch.fact.records.map((record) => (
                <p key={record.id} data-planning-original-record-id={record.id}>
                  实际原记录 {record.kind} {record.id} @ {record.version}
                </p>
              ))}
            </details>
          ))}
        </>
      )}
      {!funnel ? (
        <p>独立原规划请求漏斗未记录；不从当前资料或旧工作流补造分母。</p>
      ) : (
        <>
          <p>
            每个独立原请求是一个目标；有原回执的重试沿用该目标。首候选采用比例包含待决定，不是文学质量、爆款概率或真实模型通过率。缺原请求链的采用批次{" "}
            {funnel.unmatchedAdoptionBatches} 个，保持未匹配。
          </p>
          {funnel.measures.map((row) => (
            <div
              key={row.operation}
              data-planning-funnel-operation={row.operation}
              className="space-y-1 rounded border border-line p-2 break-words"
            >
              <h4>{labels[row.operation]}</h4>
              <p>
                实际请求 {row.recordedRequests} · 独立目标{" "}
                {row.requestedTargets} · 首候选 {row.firstCandidates} · 原样采用{" "}
                {row.firstAdopted} · 待决定 {row.pendingDecision} ·
                关闭未原样采用 {row.closedWithoutFirstAdoption} · 修改后采用{" "}
                {row.revisedAdoption} · 重试候选 {row.retryCandidates} ·
                采用被拒 {row.adoptionRejectedCount}
              </p>
              <p>
                首候选原样采用：
                {row.firstCandidateAdoptionRatio === null
                  ? "未记录首稿，不计算"
                  : `${row.firstAdopted}/${row.firstCandidates}（${(row.firstCandidateAdoptionRatio * 100).toFixed(1)}%）`}
              </p>
              {!row.sourceConflicts ? (
                <p>
                  准确规划来源冲突凭证未记录；普通拒绝与旧服务缺失不推算为零或已知变化。
                </p>
              ) : (
                <>
                  <p>
                    已核对来源冲突候选 {row.sourceConflicts.candidateCount}
                    ；缺失、无法核对与其他拒绝不计入，不是完整冲突率。
                  </p>
                  {row.sourceConflicts.last && (
                    <details
                      data-planning-source-conflict-workflow-id={
                        row.sourceConflicts.last.sourceConflict.workflowId
                      }
                    >
                      <summary>查看原规划 AI 草稿的准确来源差异</summary>
                      <p>
                        原工作流{" "}
                        {row.sourceConflicts.last.sourceConflict.workflowId} ·
                        原候选 {row.sourceConflicts.last.candidate.id}
                      </p>
                      <p>
                        原候选材料 SHA-256：
                        {row.sourceConflicts.last.candidate.contentFingerprint}
                      </p>
                      {row.sourceConflicts.last.sourceConflict.changes.map(
                        (change) => (
                          <p key={`${change.sourceKind}:${change.frozen.id}`}>
                            {change.sourceKind} · 原版本 {change.frozen.id} @{" "}
                            {change.frozen.version} → 当前观察{" "}
                            {change.current.id} @ {change.current.version}
                          </p>
                        ),
                      )}
                      <p>
                        原冲突事件 {row.sourceConflicts.last.eventId} ·{" "}
                        {new Date(
                          row.sourceConflicts.last.occurredAt,
                        ).toLocaleString()}
                      </p>
                    </details>
                  )}
                </>
              )}
              {row.firstAccepted && (
                <details>
                  <summary>查看首次实际采用凭证与耗时</summary>
                  <p>
                    原工作流 {row.firstAccepted.workflowId} · 候选{" "}
                    {row.firstAccepted.candidateId} · 采用事件{" "}
                    {row.firstAccepted.adoptedEventId}
                  </p>
                  <p>
                    {row.firstAccepted.adoptionMode === "exact-candidate"
                      ? "原样完整采用"
                      : "修改材料后采用"}{" "}
                    · 请求到候选 {duration(row.firstAccepted.requestToReadyMs)}{" "}
                    · 候选到采用 {duration(row.firstAccepted.readyToAdoptMs)} ·
                    请求到采用 {duration(row.firstAccepted.requestToAdoptMs)}
                  </p>
                </details>
              )}
            </div>
          ))}
        </>
      )}
      <p className="text-xs text-muted">
        只证明内容所有者实际提交的历史批次与原请求链；模型来源未知、质量未验证，不认证当前资料、全文覆盖或权利。旧历史不回填；无正文、标题、路径、凭据或外部遥测。
      </p>
    </section>
  );
}
