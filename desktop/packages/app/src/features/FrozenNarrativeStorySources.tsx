import type { NarrativeStorySourceBasis } from "@dramaip/contracts/knowledge";

export function FrozenNarrativeStorySources({
  sources,
}: {
  sources?: readonly NarrativeStorySourceBasis[];
}) {
  if (!sources?.length) return null;
  return (
    <section
      aria-label="本轮冻结叙事解释"
      className="mt-2 space-y-2 rounded border border-line p-3 text-xs"
    >
      <h4 className="font-semibold">本轮冻结叙事解释 {sources.length} 条</h4>
      <p className="text-muted">
        保留原声明／采用绑定、来源范围与实际输入指纹，不跟随最新目录换源。这里只纳入作者明确采用的解释和端点名称，未附带引文、正文或端点摘要；不增加整章表达覆盖，也不证明模型读过或理解原著。
      </p>
      {sources.map((source) => (
        <details
          key={`${source.selection.kind}:${source.selection.id}`}
          className="break-all"
        >
          <summary className="cursor-pointer">
            {source.selection.kind} {source.selection.id} v
            {source.selection.version}
          </summary>
          <p>
            实际 {source.record.kind} {source.record.id} v
            {source.record.version}
          </p>
          <p>原来源指纹 {source.sourceFingerprint}</p>
          <p>实际输入指纹 {source.contentHash}</p>
          {source.sourceChapters.map((chapter) => (
            <p key={chapter.id}>
              原章节 {chapter.id} v{chapter.version}
            </p>
          ))}
          {source.sourceScripts.map((script) => (
            <p key={script.id}>
              原剧本 {script.id} v{script.version}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
