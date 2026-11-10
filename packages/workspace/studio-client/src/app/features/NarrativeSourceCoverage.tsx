import {
  narrativeChapterRepresentations,
  type NarrativeSourceBasis,
} from "@dramaip/contracts/creation";
import { FrozenNarrativeStorySources } from "./FrozenNarrativeStorySources";
import styles from "./NarrativeSourceCoverage.module.css";
import { copyText } from "../copy";

const labels: Record<string, string> = {
  original: "完整原文",
  summary: "已采用章节摘要",
  paragraphs: "所选原文段落",
  "hierarchical-summary": "高层冻结范围摘要",
};
export function NarrativeSourceCoverage(props: {
  basis: NarrativeSourceBasis;
  chapters: { id: string; version: number; title: string }[];
  label: string;
}) {
  return (
    <section aria-label={props.label} className={styles.c1}>
      <h4 className={styles.c2}>
        {props.label}
        {copyText("app/features/NarrativeSourceCoverage.1")}
      </h4>
      {props.chapters.map((chapter) => (
        <p key={chapter.id}>
          {chapter.title}
          {copyText("app/features/NarrativeSourceCoverage.2")}
          {chapter.version}：
          {narrativeChapterRepresentations(props.basis, chapter.id)
            .map((item) => labels[item] ?? item)
            .join(" + ")}
        </p>
      ))}
      {props.basis.summaries?.map((summary) => (
        <details key={summary.id} className={styles.c3}>
          <summary>
            {copyText("app/features/NarrativeSourceCoverage.3")}
          </summary>
          <p>
            {summary.scopeTitle} · {summary.id}
            {copyText("app/features/NarrativeSourceCoverage.2")}
            {summary.version}
            {copyText("app/features/NarrativeSourceCoverage.4")}
            {summary.scopeState === "current" ? "有效" : "已变化"}
            {copyText("app/features/NarrativeSourceCoverage.5")}
          </p>
          {summary.chapters.map((chapter) => (
            <p key={chapter.id}>
              {chapter.id}
              {copyText("app/features/NarrativeSourceCoverage.2")}
              {chapter.version}
            </p>
          ))}
        </details>
      ))}
      <details className={styles.c3} data-frozen-narrative-references>
        <summary>
          {copyText("app/features/NarrativeSourceCoverage.6")}
          {props.basis.references.length}
          {copyText("app/features/NarrativeSourceCoverage.7")}
        </summary>
        <p className={styles.c4}>
          {copyText("app/features/NarrativeSourceCoverage.8")}
        </p>
        {props.basis.references.map((reference, position) => (
          <div key={position} className={styles.c5}>
            <p>
              {reference.sourceKind} {reference.sourceId}
              {copyText("app/features/NarrativeSourceCoverage.2")}
              {reference.sourceVersion}
            </p>
            <p>{reference.fieldPath}</p>
            <p>
              {copyText("app/features/NarrativeSourceCoverage.9")}
              {reference.contentHash}
            </p>
          </div>
        ))}
      </details>
      {props.basis.omitted.length > 0 && (
        <details className={styles.c3} data-frozen-narrative-omissions>
          <summary>
            {copyText("app/features/NarrativeSourceCoverage.10")}
            {props.basis.omitted.length}
            {copyText("app/features/NarrativeSourceCoverage.11")}
          </summary>
          <p className={styles.c4}>
            {copyText("app/features/NarrativeSourceCoverage.12")}
          </p>
          {props.basis.omitted.map((chapter) => (
            <p key={chapter.id}>
              {chapter.id}
              {copyText("app/features/NarrativeSourceCoverage.2")}
              {chapter.version} ·
              {chapter.reason === "empty"
                ? "空章，未纳入表达"
                : "明确未选，未纳入表达"}
            </p>
          ))}
        </details>
      )}
      <FrozenNarrativeStorySources sources={props.basis.story} />
      <p className={styles.c4}>
        {copyText("app/features/NarrativeSourceCoverage.13")}
      </p>
    </section>
  );
}
