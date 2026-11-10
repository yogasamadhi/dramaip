import type {
  ScreenplayBlock,
  ScreenplayLossReport,
} from "@dramaip/contracts/production";
import styles from "./NativeScreenplayPreview.module.css";
import { copyText } from "../../copy";

export function screenplayLossLabel(value: string) {
  if (value.startsWith("paragraph_type:"))
    return `未知段落类型（转为注释）：${value.slice(15)}`;
  return (
    (
      {
        dual_dialogue_layout: "双栏对白排版",
        scene_numbers: "场景编号",
        notes: "注释",
        page_breaks: "分页",
        basic_formatting: "基本格式",
        paragraph_types: "段落类型",
        text_content: "文本内容",
      } as Record<string, string>
    )[value] ?? value
  );
}
export function NativeScreenplayPreview({
  blocks,
  lossReport,
  showBlocks = true,
}: {
  blocks: ScreenplayBlock[];
  lossReport: ScreenplayLossReport;
  showBlocks?: boolean;
}) {
  return (
    <>
      <details
        aria-label={copyText(
          "app/features/production/NativeScreenplayPreview.1",
        )}
        open
        className={styles.c1}
      >
        <summary className={styles.c2}>
          {copyText("app/features/production/NativeScreenplayPreview.2")}
        </summary>
        <p className={styles.c3}>
          {copyText("app/features/production/NativeScreenplayPreview.3")}
          {lossReport.unsupported.length
            ? lossReport.unsupported.map(screenplayLossLabel).join("；")
            : "未报告（不证明所有专有排版无损）"}
        </p>
        <p>
          {copyText("app/features/production/NativeScreenplayPreview.4")}
          {lossReport.warnings.join("；") || "未报告"}
        </p>
        <p>
          {copyText("app/features/production/NativeScreenplayPreview.5")}
          {lossReport.preserved.map(screenplayLossLabel).join("；") || "未报告"}
        </p>
      </details>
      {showBlocks && (
        <details
          aria-label={copyText(
            "app/features/production/NativeScreenplayPreview.6",
          )}
          className={styles.c1}
        >
          <summary>
            {copyText("app/features/production/NativeScreenplayPreview.7")}
          </summary>
          <div className={styles.c4}>
            {blocks.map((block, index) => (
              <article key={`${block.id}:${index}`} className={styles.c5}>
                <p className={styles.c6}>
                  {copyText(
                    "app/features/production/NativeScreenplayPreview.8",
                  )}
                  {index + 1} · {block.id} · {block.type}
                  {block.sourceLocation
                    ? ` · 来源位置 ${block.sourceLocation.line}:${block.sourceLocation.column}`
                    : ""}
                </p>
                <p className={styles.c7}>
                  {"text" in block ? block.text : "— 分页 —"}
                </p>
              </article>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
