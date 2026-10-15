import type { CreativeOutcomeSummary } from "@dramaip/contracts/insights";

/** Read-only original owner receipts. No current-child reads or actions. */
export function SourceConfirmations({
  value,
}: {
  value: CreativeOutcomeSummary["sourceConfirmations"];
}) {
  if (value.recordedConfirmations === 0) return null;
  return (
    <section
      aria-label="来源确认历史"
      className="space-y-2 rounded-lg border border-line p-3 text-sm"
    >
      <h3 className="font-medium">来源确认历史</h3>
      <p>
        本机已记录 {value.recordedConfirmations} 次；显示最近{" "}
        {value.items.length} 次，每次最多前 5 个原绑定，不是完整映射列表。
      </p>
      <p>
        {value.byWorkflow
          .map(
            (row) =>
              `${row.workflowPath === "novel" ? "小说项目" : row.workflowPath === "adaptation" ? "剧本 / 改编项目" : "其他项目模式"} ${row.total}`,
          )
          .join(" · ")}
      </p>
      {value.items.map((source) => (
        <div
          key={source.eventId}
          data-source-confirmation-id={source.sourceId}
          className="space-y-1 rounded border border-line p-2 break-words"
        >
          <p>
            {source.entry === "ordinary-import" ? "普通导入" : "原生剧本导入"} ·{" "}
            {source.sourceFormat} · 原解析条目 {source.entryCount} ·
            实际保存场景 {source.sceneCount}
          </p>
          <p>
            原来源 {source.sourceId} · 原项目 {source.projectId} @{" "}
            {source.projectVersion}
          </p>
          <p>
            首次最终提交：{new Date(source.occurredAt).toLocaleString()} ·{" "}
            {source.owner}
          </p>
          {source.entries.map((entry) => (
            <p key={entry.id} data-original-source-binding-id={entry.id}>
              原条目 {entry.sourceIndex + 1} →{" "}
              {entry.kind === "chapter"
                ? "章节"
                : entry.kind === "script-record"
                  ? "剧本记录"
                  : "剧本文档"}{" "}
              {entry.id} @ {entry.version}
              {entry.kind === "script-document" && (
                <>
                  {" "}
                  · 原预览条目 {entry.previewEntryId} · 剧本 {entry.scriptId} @{" "}
                  {entry.scriptVersion}
                </>
              )}
            </p>
          ))}
          <details className="text-xs text-muted">
            <summary>本机原绑定／回执指纹</summary>
            <p>原绑定 SHA-256：{source.bindingFingerprint}</p>
            <p>完整原回执 SHA-256：{source.receiptFingerprint}</p>
          </details>
          {source.lossReportReviewed && (
            <p>原请求已声明审阅损失报告；不认证转换无损或授权。</p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted">
        只证明明确确认的解析条目已由对应 owner
        保存，不是整个原文件／全文已读或语义谱系。权利声明未核验，模型来源未知、质量未验证、当前有效性未评估；显示原历史版本，不替换为当前子项。
      </p>
      <p className="text-xs text-muted">
        项目产品路径不是创建时明确目标。旧历史不补确认，不增加正式成果数、首稿采用率或七天继续率分母；无正文、文件名、路径、grant
        或外部遥测。
      </p>
    </section>
  );
}
