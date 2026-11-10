import type { ProductionRecordBaselineObservations } from "@dramaip/contracts/production";
import styles from "./ProductionRecordBaselines.module.css";
import { copyText } from "../../copy";

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
      aria-label={copyText(
        "app/features/production/ProductionRecordBaselines.1",
      )}
      className={styles.c1}
    >
      <summary>
        {copyText("app/features/production/ProductionRecordBaselines.1")}
      </summary>
      <p className={styles.c2}>
        {copyText("app/features/production/ProductionRecordBaselines.2")}
      </p>
      {!value ? (
        <p>{copyText("app/features/production/ProductionRecordBaselines.3")}</p>
      ) : (
        <>
          <p>
            {value.records.length}
            {copyText(
              "app/features/production/ProductionRecordBaselines.4",
            )}{" "}
            {value.records.filter((item) => item.state === "unchanged").length}{" "}
            {copyText("app/features/production/ProductionRecordBaselines.5")}{" "}
            {value.records.filter((item) => item.state !== "unchanged").length}{" "}
            {copyText("app/features/production/ProductionRecordBaselines.6")}
          </p>
          {value.records.map((item) => (
            <details
              key={item.id}
              data-record-id={item.id}
              className={styles.c3}
            >
              <summary>
                {item.kind === "scenes" ? "场景" : "镜头"} {item.stableId}：
                {states[item.state]}
              </summary>
              <p>
                {copyText(
                  "app/features/production/ProductionRecordBaselines.7",
                )}
                {item.id}
                {copyText(
                  "app/features/production/ProductionRecordBaselines.8",
                )}
                {item.frozenVersion}
                {copyText(
                  "app/features/production/ProductionRecordBaselines.9",
                )}{" "}
                {item.current ? `v${item.current.version}` : "未核全或缺失"}
              </p>
              {item.frozen && (
                <>
                  <p>
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.10",
                    )}
                    {item.frozen.capturedResult.id}
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.11",
                    )}
                    {item.frozen.capturedResult.version}
                  </p>
                  <p>
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.12",
                    )}
                    {item.frozen.parentId ?? "无父级"}
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.13",
                    )}{" "}
                    {item.frozen.orderIndex}
                  </p>
                  <p>
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.14",
                    )}
                    {item.frozen.contentHash}
                  </p>
                </>
              )}
              {item.current && (
                <>
                  <p>
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.15",
                    )}
                    {item.current.parentId ?? "无父级"}
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.16",
                    )}{" "}
                    {item.current.orderIndex}
                  </p>
                  <p>
                    {copyText(
                      "app/features/production/ProductionRecordBaselines.17",
                    )}
                    {item.current.contentHash}
                  </p>
                </>
              )}
              {item.changes.map((change) => (
                <p key={change.field}>
                  {fields[change.field]}
                  {copyText(
                    "app/features/production/ProductionRecordBaselines.18",
                  )}
                  {change.beforeHash} → {change.afterHash}
                </p>
              ))}
            </details>
          ))}
        </>
      )}
    </details>
  );
}
