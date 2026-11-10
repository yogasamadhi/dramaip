import type { IPTwinSnapshot } from "@dramaip/contracts";
import styles from "./StoryRuleReview.module.css";
import { copyText } from "../../copy";

/** Locations always resolve inside this original frozen snapshot, never latest. */
export function StoryRuleReview({ snapshot }: { snapshot: IPTwinSnapshot }) {
  const analysis = snapshot.ruleAnalysis;
  if (!analysis)
    return (
      <div
        aria-label={copyText("app/features/creative/StoryRuleReview.1")}
        className={styles.c1}
      >
        <p>{copyText("app/features/creative/StoryRuleReview.2")}</p>
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
      aria-label={copyText("app/features/creative/StoryRuleReview.3")}
      data-rule-set={analysis.ruleSet}
      className={styles.c2}
    >
      <p className={styles.c3}>
        {copyText("app/features/creative/StoryRuleReview.4")}
        {analysis.ruleSet}
        {copyText("app/features/creative/StoryRuleReview.5")}{" "}
        {analysis.coverage.nodeCount}
        {copyText("app/features/creative/StoryRuleReview.6")}
        {analysis.coverage.edgeCount}
        {copyText("app/features/creative/StoryRuleReview.7")}{" "}
        {analysis.coverage.cognitionCount}
        {copyText("app/features/creative/StoryRuleReview.8")}
      </p>
      <p className={styles.c3}>
        {copyText("app/features/creative/StoryRuleReview.9")}
      </p>
      {!analysis.findings.length && (
        <p>{copyText("app/features/creative/StoryRuleReview.10")}</p>
      )}
      {analysis.findings.map((finding) => (
        <article
          key={finding.id}
          data-rule-finding-id={finding.id}
          data-rule-code={finding.code}
          className={styles.c4}
        >
          <p>
            {copyText("app/features/creative/StoryRuleReview.11")}
            {finding.summary}
          </p>
          <p className={styles.c3}>{finding.advice}</p>
          <details>
            <summary className={styles.c5}>
              {copyText("app/features/creative/StoryRuleReview.12")}
              {finding.records.length}）
            </summary>
            <ul className={styles.c6}>
              {finding.records.map((ref) => {
                const value = records[ref.kind].get(ref.id);
                return (
                  <li
                    key={`${ref.kind}:${ref.id}`}
                    data-rule-record-id={ref.id}
                    className={styles.c7}
                  >
                    <p className={styles.c8}>
                      {labels[ref.kind]} {ref.id}
                      {copyText("app/features/creative/StoryRuleReview.13")}
                      {ref.version}
                    </p>
                    <pre className={styles.c9}>
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  </li>
                );
              })}
            </ul>
          </details>
        </article>
      ))}
      <p className={styles.c3}>
        {copyText("app/features/creative/StoryRuleReview.14")}
      </p>
    </div>
  );
}
