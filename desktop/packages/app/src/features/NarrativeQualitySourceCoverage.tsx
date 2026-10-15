import type { NarrativeQualityBasis } from "@dramaip/contracts/creative-quality";
import { NarrativeSourceCoverage } from "./NarrativeSourceCoverage";

export function NarrativeQualitySourceCoverage({
  basis,
}: {
  basis: Pick<NarrativeQualityBasis, "sourceBasis" | "chapterCoverage">;
}) {
  if (!basis.sourceBasis) return null;
  return (
    <div data-quality-frozen-source-coverage>
      {!basis.chapterCoverage && (
        <p className="text-sm text-muted">
          冻结章节覆盖未提供；范围未知，不以空目录或 0 冒充已核全。
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
