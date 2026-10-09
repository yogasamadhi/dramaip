import type { ProductionRecordBaselineObservations } from "@dramaip/contracts/production";

const states = {
  unchanged: "实际身份、版本及全部保存字段未观察到变化",
  changed: "实际版本或保存字段已变化，不能自动覆盖",
  unrecorded: "历史未记录实际字段基准，不从模型内容补造",
  "baseline-invalid": "原基准身份或字段指纹未核全",
  "record-missing": "当前实际记录缺失",
  "record-invalid": "当前实际记录身份或字段未核全",
} as const;
const fields = {
  title: "标题",
  parentId: "实际父级",
  orderIndex: "实际顺序",
  payload: "完整保存字段",
} as const;

/** Readonly hashes, not raw baseline prose, merge choices or review approval. */
export function ProductionRecordBaselines({
  value,
}: {
  value?: ProductionRecordBaselineObservations;
}) {
  return (
    <details
      aria-label="实际场景与镜头字段基准"
      className="space-y-2 rounded border border-line p-2"
    >
      <summary>实际场景与镜头字段基准</summary>
      <p className="text-muted">
        只核对原采用时保存的实际记录；不输出正文或自定义字段原值，不从模型方案反推旧人工内容。指纹一致不是语义安全，不解除来源失效或全包复核，也不执行冲突合并。
      </p>
      {!value ? (
        <p>此原清单未提供实际字段基准明细；未读取不等于未变化。</p>
      ) : (
        <>
          <p>
            {value.records.length} 个实际记录 ·{" "}
            {value.records.filter((item) => item.state === "unchanged").length}{" "}
            个字段基准一致 ·{" "}
            {value.records.filter((item) => item.state !== "unchanged").length}{" "}
            个变化或未核全
          </p>
          {value.records.map((item) => (
            <details
              key={item.id}
              data-record-id={item.id}
              className="break-all"
            >
              <summary>
                {item.kind === "scenes" ? "场景" : "镜头"} {item.stableId}：
                {states[item.state]}
              </summary>
              <p>
                实际记录 {item.id} · 冻结 v{item.frozenVersion} → 实际{" "}
                {item.current ? `v${item.current.version}` : "未核全或缺失"}
              </p>
              {item.frozen && (
                <>
                  <p>
                    基准保存于正式结果 {item.frozen.capturedResult.id} · v
                    {item.frozen.capturedResult.version}
                  </p>
                  <p>
                    原父级 {item.frozen.parentId ?? "无父级"} · 原顺序{" "}
                    {item.frozen.orderIndex}
                  </p>
                  <p>原实际字段指纹：{item.frozen.contentHash}</p>
                </>
              )}
              {item.current && (
                <>
                  <p>
                    当前父级 {item.current.parentId ?? "无父级"} · 当前顺序{" "}
                    {item.current.orderIndex}
                  </p>
                  <p>当前实际字段指纹：{item.current.contentHash}</p>
                </>
              )}
              {item.changes.map((change) => (
                <p key={change.field}>
                  {fields[change.field]}变化 · {change.beforeHash} →{" "}
                  {change.afterHash}
                </p>
              ))}
            </details>
          ))}
        </>
      )}
    </details>
  );
}
