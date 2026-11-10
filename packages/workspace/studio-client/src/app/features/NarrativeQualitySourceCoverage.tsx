import type { NarrativeQualityBasis } from "@dramaip/contracts/creative-quality";
import { NarrativeSourceCoverage } from "./NarrativeSourceCoverage";
import styles from "./NarrativeQualitySourceCoverage.module.css";
import { copyText } from "../copy";

export function NarrativeQualitySourceCoverage({
  basis,
}: {
  basis: Pick<NarrativeQualityBasis, "sourceBasis" | "chapterCoverage">;
}) {
  if (!basis.sourceBasis) return null;
  return (
    <div data-quality-frozen-source-coverage>
      {!basis.chapterCoverage && (
        <p className={styles.c1}>
          {copyText("app/features/NarrativeQualitySourceCoverage.1")}
        </p>
      )}
      <NarrativeSourceCoverage
        basis={basis.sourceBasis}
        chapters={basis.chapterCoverage?.included ?? []}
        label="质量评议原参考内容表达"
      />
    </div>
  );
}
