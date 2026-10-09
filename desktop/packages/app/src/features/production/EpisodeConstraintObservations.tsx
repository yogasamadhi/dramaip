import type {
  EpisodeUpstreamConstraint,
  EpisodeUpstreamConstraints,
  EpisodeConstraintSnapshot,
} from "@dramaip/contracts/production";

const kinds: Record<EpisodeUpstreamConstraint["kind"], string> = {
  "season-plan": "整季方案",
  "adaptation-diagnosis": "改编诊断",
  "adaptation-strategy": "独立策略",
  "author-intent": "作者意图",
  "story-bible": "已批准故事圣经",
  "episode-outline": "正式单集大纲",
  "episode-script": "正式标准剧本",
  "direct-project": "直写项目简报",
  "direct-episode": "直写实际分集",
  "direct-source-script": "直写原剧本",
};
const changes: Record<EpisodeUpstreamConstraint["change"], string> = {
  "same-reference": "身份／版本未观察变化",
  changed: "版本、顺序或已知指纹变化",
  replaced: "当前正式头已替换",
  added: "当前集合新增",
  removed: "当前记录或正式头已缺失",
  unavailable: "实际读取未核全",
  unverified: "原绑定未核全",
};
function Snapshot({
  value,
  label,
  missing,
}: {
  value: EpisodeConstraintSnapshot | null;
  label: string;
  missing: string;
}) {
  if (!value) return <span>{missing}</span>;
  return (
    <div className="space-y-1 break-all">
      <p>
        {value.id} · v{value.version}
      </p>
      {value.position !== undefined && <p>集合位置 {value.position + 1}</p>}
      {value.documentVersion !== undefined && (
        <p>
          保存文档版本：
          {value.documentVersion === null
            ? "未记录"
            : `v${value.documentVersion}`}
        </p>
      )}
      {value.contentHash ? (
        <details>
          <summary>{label}内容指纹</summary>
          <code className="break-all">{value.contentHash}</code>
        </details>
      ) : (
        <p className="text-muted">原清单未记录内容指纹，不补造正文一致证明。</p>
      )}
    </div>
  );
}
export function EpisodeConstraintObservations({
  value,
}: {
  value?: EpisodeUpstreamConstraints;
}) {
  return (
    <section
      aria-label="上游正式约束版本核对"
      className="space-y-2 rounded border border-line p-2"
    >
      <h4 className="font-medium">上游正式约束版本核对</h4>
      <p className="text-muted">
        只列本包的实际正式约束身份、版本与已知指纹，不是全部原著来源或语义影响证明。身份／版本一致不证明正文不变；不解除来源失效或全包复核，也不换源、改稿或自动重做。
      </p>
      {!value ? (
        <p role="status">
          此原清单未提供正式约束明细；不能把缺失当作空集合或已核全，也不读取最新成果补足。
        </p>
      ) : (
        <>
          <p>
            已批准故事圣经：冻结 {value.approvedStoryBible.frozenCount} 份 →
            当前 {value.approvedStoryBible.currentCount ?? "未核全"} 份；
            {value.approvedStoryBible.readState === "available"
              ? "本次实际集合已读取"
              : "本次实际集合读取未核全"}
            。
          </p>
          <table className="w-full table-fixed text-left align-top">
            <caption className="sr-only">
              原冻结与当前实际正式约束的脱敏版本比较
            </caption>
            <thead>
              <tr>
                <th className="w-1/3 p-1">约束与实际变化</th>
                <th className="w-1/3 p-1">原冻结</th>
                <th className="w-1/3 p-1">当前实际</th>
              </tr>
            </thead>
            <tbody>
              {value.items.map((item) => (
                <tr
                  key={`${item.kind}:${item.frozen?.id ?? item.current?.id ?? "unavailable"}`}
                  data-constraint-kind={item.kind}
                  data-constraint-id={item.frozen?.id ?? item.current?.id}
                  className="border-t border-line align-top"
                >
                  <th className="break-all p-1 font-normal">
                    <p>{kinds[item.kind]}</p>
                    <p>{changes[item.change]}</p>
                  </th>
                  <td className="p-1">
                    <Snapshot
                      value={item.frozen}
                      label="原冻结"
                      missing="原清单未绑定此记录"
                    />
                  </td>
                  <td className="p-1">
                    <Snapshot
                      value={item.current}
                      label="当前实际"
                      missing={
                        item.readState === "unavailable"
                          ? "当前读取未核全"
                          : "当前记录或正式头不存在"
                      }
                    />
                    <p className="text-muted">
                      {item.currentSourceState === "stale"
                        ? "来源服务报告当前来源失效"
                        : item.currentSourceState === "current"
                          ? "来源服务报告当前来源有效"
                          : "单项来源状态未单独核验"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
