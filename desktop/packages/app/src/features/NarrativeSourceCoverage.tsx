import {
  narrativeChapterRepresentations,
  type NarrativeSourceBasis,
} from "@dramaip/contracts/creation";
import { FrozenNarrativeStorySources } from "./FrozenNarrativeStorySources";

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
    <section
      aria-label={props.label}
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <h4 className="font-semibold">{props.label}（摘要／片段不是全文阅读）</h4>
      {props.chapters.map((chapter) => (
        <p key={chapter.id}>
          {chapter.title} v{chapter.version}：
          {narrativeChapterRepresentations(props.basis, chapter.id)
            .map((item) => labels[item] ?? item)
            .join(" + ")}
        </p>
      ))}
      {props.basis.summaries?.map((summary) => (
        <details key={summary.id} className="break-all">
          <summary>高层摘要原冻结身份与章节版本</summary>
          <p>
            {summary.scopeTitle} · {summary.id} v{summary.version} ·
            冻结时完整范围{summary.scopeState === "current" ? "有效" : "已变化"}
            ；使用原覆盖，不扩大范围。
          </p>
          {summary.chapters.map((chapter) => (
            <p key={chapter.id}>
              {chapter.id} v{chapter.version}
            </p>
          ))}
        </details>
      ))}
      <details className="break-all" data-frozen-narrative-references>
        <summary>
          实际冻结引用与输入指纹（{props.basis.references.length} 条）
        </summary>
        <p className="text-muted">
          仅列原冻结表达身份，不读取最新正文、改选来源或证明模型已经理解。
        </p>
        {props.basis.references.map((reference, position) => (
          <div key={position} className="mt-2">
            <p>
              {reference.sourceKind} {reference.sourceId} v
              {reference.sourceVersion}
            </p>
            <p>{reference.fieldPath}</p>
            <p>SHA-256 {reference.contentHash}</p>
          </div>
        ))}
      </details>
      {props.basis.omitted.length > 0 && (
        <details className="break-all" data-frozen-narrative-omissions>
          <summary>
            本冻结允许范围内未纳入的章节（{props.basis.omitted.length} 章）
          </summary>
          <p className="text-muted">
            这里只是本次编译的允许范围，不是全书目录；范围外章节数量不能由本列表推断。
          </p>
          {props.basis.omitted.map((chapter) => (
            <p key={chapter.id}>
              {chapter.id} v{chapter.version} ·
              {chapter.reason === "empty"
                ? "空章，未纳入表达"
                : "明确未选，未纳入表达"}
            </p>
          ))}
        </details>
      )}
      <FrozenNarrativeStorySources sources={props.basis.story} />
      <p className="text-muted">
        完整纳入表达和引用声明不保证模型理解原著或语义判断正确；实际
        usage／费用未提供时为未知。
      </p>
    </section>
  );
}
