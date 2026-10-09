import type { CreationIssue } from "@dramaip/contracts/creation";

export function CreationIssueEvidence({ issue }: { issue: CreationIssue }) {
  if (issue.source !== "model") return null;
  const recorded = issue.candidateEvidence;
  if (!recorded)
    return (
      <p className="mt-2 text-xs text-muted">
        此历史意见未记录候选引文位置，不从最新稿补造证据。
      </p>
    );
  return (
    <details
      aria-label="本轮候选引文定位"
      className="mt-2 break-all text-xs text-muted"
    >
      <summary>本轮候选引文位置（{recorded.matches.length} 处）</summary>
      <p className="mt-2">
        仅记录逐字匹配，不证明模型判断正确；位置标签仍是 AI
        审阅意见。字符位置为从 0 开始、末位不含的 UTF-16 区间。
      </p>
      <p>检查时候选 SHA-256：{recorded.candidateSha256}</p>
      <ul className="mt-1 space-y-1">
        {recorded.matches.map((match) => (
          <li key={`${match.valuePath}:${match.start}:${match.end}`}>
            {match.valuePath} · [{match.start}, {match.end})
          </li>
        ))}
      </ul>
    </details>
  );
}
