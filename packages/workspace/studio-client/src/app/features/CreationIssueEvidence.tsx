import type { CreationIssue } from "@dramaip/contracts/creation";
import styles from "./CreationIssueEvidence.module.css";
import { copyText } from "../copy";

export function CreationIssueEvidence({ issue }: { issue: CreationIssue }) {
  if (issue.source !== "model") return null;
  const recorded = issue.candidateEvidence;
  if (!recorded)
    return (
      <p className={styles.c1}>
        {copyText("app/features/CreationIssueEvidence.1")}
      </p>
    );
  return (
    <details
      aria-label={copyText("app/features/CreationIssueEvidence.2")}
      className={styles.c2}
    >
      <summary>
        {copyText("app/features/CreationIssueEvidence.3")}
        {recorded.matches.length}
        {copyText("app/features/CreationIssueEvidence.4")}
      </summary>
      <p className={styles.c3}>
        {copyText("app/features/CreationIssueEvidence.5")}
      </p>
      <p>
        {copyText("app/features/CreationIssueEvidence.6")}
        {recorded.candidateSha256}
      </p>
      <ul className={styles.c4}>
        {recorded.matches.map((match) => (
          <li key={`${match.valuePath}:${match.start}:${match.end}`}>
            {match.valuePath} · [{match.start}, {match.end})
          </li>
        ))}
      </ul>
    </details>
  );
}
