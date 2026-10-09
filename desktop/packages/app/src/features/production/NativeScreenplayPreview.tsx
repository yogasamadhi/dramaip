import type {
  ScreenplayBlock,
  ScreenplayLossReport,
} from "@dramaip/contracts/production";

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
        aria-label="格式损失报告"
        open
        className="rounded border border-line p-3"
      >
        <summary className="font-medium">
          格式损失报告（不等于无损还原或文学质量检查）
        </summary>
        <p className="mt-2">
          不支持／已转换：
          {lossReport.unsupported.length
            ? lossReport.unsupported.map(screenplayLossLabel).join("；")
            : "未报告（不证明所有专有排版无损）"}
        </p>
        <p>警告：{lossReport.warnings.join("；") || "未报告"}</p>
        <p>
          保留：
          {lossReport.preserved.map(screenplayLossLabel).join("；") || "未报告"}
        </p>
      </details>
      {showBlocks && (
        <details
          aria-label="完整原稿块预览"
          className="rounded border border-line p-3"
        >
          <summary>核对全部导入块及稳定标识（导入时冻结内容）</summary>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {blocks.map((block, index) => (
              <article
                key={`${block.id}:${index}`}
                className="rounded border border-line p-2"
              >
                <p className="break-all text-xs text-muted">
                  块 {index + 1} · {block.id} · {block.type}
                  {block.sourceLocation
                    ? ` · 来源位置 ${block.sourceLocation.line}:${block.sourceLocation.column}`
                    : ""}
                </p>
                <p className="whitespace-pre-wrap leading-7">
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
