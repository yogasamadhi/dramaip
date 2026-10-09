import type { IPTwinSnapshot } from "@dramaip/contracts";

/** Locations always resolve inside this original frozen snapshot, never latest. */
export function StoryRuleReview({ snapshot }: { snapshot: IPTwinSnapshot }) {
  const analysis = snapshot.ruleAnalysis;
  if (!analysis)
    return (
      <div aria-label="历史规则边界" className="space-y-2 text-xs text-muted">
        <p>
          旧快照只有历史文本规则，未回填新版定位；需核对后明确创建新快照。历史文本不升级为原文、语义或质量证明。
        </p>
        <ul>
          {snapshot.conflicts.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      </div>
    );
  const labels = { node: "节点", edge: "关系", cognition: "认知" } as const;
  const records = {
    node: new Map(snapshot.nodes.map((value) => [value.id, value])),
    edge: new Map(snapshot.edges.map((value) => [value.id, value])),
    cognition: new Map(
      snapshot.audienceStates.map((value) => [value.id, value]),
    ),
  };
  return (
    <div
      aria-label="原冻结规则定位"
      data-rule-set={analysis.ruleSet}
      className="space-y-3 rounded-lg border border-line p-3"
    >
      <p className="text-xs text-muted">
        规则 {analysis.ruleSet} · 当前冻结声明范围：节点{" "}
        {analysis.coverage.nodeCount}／关系 {analysis.coverage.edgeCount}／认知{" "}
        {analysis.coverage.cognitionCount}。
        只检查声明结构；未读取原文、理解作者解释或评定文学质量。
      </p>
      <p className="text-xs text-muted">
        导致／使之可能按起点→终点；“起点依赖终点”按终点→起点核对前置关系。揭示只表示起点揭示终点，不证明揭示时点或认知解释成立。
      </p>
      {!analysis.findings.length && (
        <p>
          本规则集未发现结构复核线索；不等于故事无矛盾、原文已核验或质量通过。
        </p>
      )}
      {analysis.findings.map((finding) => (
        <article
          key={finding.id}
          data-rule-finding-id={finding.id}
          data-rule-code={finding.code}
          className="space-y-2 rounded-lg border border-line p-3"
        >
          <p>待人工复核 · {finding.summary}</p>
          <p className="text-xs text-muted">{finding.advice}</p>
          <details>
            <summary className="cursor-pointer text-xs">
              查看原冻结记录与版本（{finding.records.length}）
            </summary>
            <ul className="mt-2 space-y-2">
              {finding.records.map((ref) => {
                const value = records[ref.kind].get(ref.id);
                return (
                  <li
                    key={`${ref.kind}:${ref.id}`}
                    data-rule-record-id={ref.id}
                    className="rounded border border-line p-2 text-xs"
                  >
                    <p className="break-all">
                      {labels[ref.kind]} {ref.id} · 冻结 v{ref.version}
                    </p>
                    <pre className="mt-1 whitespace-pre-wrap break-all">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  </li>
                );
              })}
            </ul>
          </details>
        </article>
      ))}
      <p className="text-xs text-muted">
        位置只绑定此快照的原记录和版本，不读取最新替代。提示没有自动通过、忽略、改稿或采用入口。
      </p>
    </div>
  );
}
