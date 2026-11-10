import type { NarrativeStorySourceBasis } from "@dramaip/contracts/knowledge";
import styles from "./FrozenNarrativeStorySources.module.css";
import { copyText } from "../copy";

export function FrozenNarrativeStorySources({
  sources,
}: {
  sources?: readonly NarrativeStorySourceBasis[];
}) {
  if (!sources?.length) return null;
  return (
    <section
      aria-label={copyText("app/features/FrozenNarrativeStorySources.1")}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/FrozenNarrativeStorySources.2")}
        {sources.length}
        {copyText("app/features/FrozenNarrativeStorySources.3")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/FrozenNarrativeStorySources.4")}
      </p>
      {sources.map((source) => (
        <details
          key={`${source.selection.kind}:${source.selection.id}`}
          className={styles.c4}
        >
          <summary className={styles.c5}>
            {source.selection.kind} {source.selection.id}
            {copyText("app/features/FrozenNarrativeStorySources.5")}
            {source.selection.version}
          </summary>
          <p>
            {copyText("app/features/FrozenNarrativeStorySources.6")}
            {source.record.kind} {source.record.id}
            {copyText("app/features/FrozenNarrativeStorySources.5")}
            {source.record.version}
          </p>
          <p>
            {copyText("app/features/FrozenNarrativeStorySources.7")}
            {source.sourceFingerprint}
          </p>
          <p>
            {copyText("app/features/FrozenNarrativeStorySources.8")}
            {source.contentHash}
          </p>
          {source.sourceChapters.map((chapter) => (
            <p key={chapter.id}>
              {copyText("app/features/FrozenNarrativeStorySources.9")}
              {chapter.id}
              {copyText("app/features/FrozenNarrativeStorySources.5")}
              {chapter.version}
            </p>
          ))}
          {source.sourceScripts.map((script) => (
            <p key={script.id}>
              {copyText("app/features/FrozenNarrativeStorySources.10")}
              {script.id}
              {copyText("app/features/FrozenNarrativeStorySources.5")}
              {script.version}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
