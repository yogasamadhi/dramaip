import { Button } from "@dramaip/infra-ui-primitives";
import type { CreationMerge } from "@dramaip/contracts/creation";
import {
  completeScriptMergeOrder,
  moveScriptMergeBlock,
  selectedScriptMergeIds,
} from "../script-merge-order";
import styles from "./ScriptMergeOrderReview.module.css";
import { copyText } from "../copy";
const changeLabels = {
  unchanged: "未改变",
  added: "新增",
  deleted: "移除",
  modified: "正文修改",
  moved: "位置移动",
  conflict: "待选择冲突",
} as const;

export function ScriptMergeOrderReview({
  merge,
  choices,
  draft,
  confirmed,
  busy,
  onOrder,
  onConfirm,
}: {
  merge: CreationMerge;
  choices: Record<string, "main" | "branch">;
  draft?: string[];
  confirmed: boolean;
  busy: boolean;
  onOrder: (order: string[]) => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  if (!merge.blockOrder)
    return <p>{copyText("app/features/ScriptMergeOrderReview.1")}</p>;
  const selected = selectedScriptMergeIds(merge, choices);
  const order = completeScriptMergeOrder(
    draft ?? merge.blockOrder.proposed,
    selected,
  );
  const manual = Boolean(draft) || merge.blockOrder.conflict;
  return (
    <section
      aria-label={copyText("app/features/ScriptMergeOrderReview.2")}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/ScriptMergeOrderReview.3")}
      </h4>
      <p>
        {merge.blockOrder.conflict
          ? "排序存在冲突：不能猜测相对位置，须明确排列并确认全部保留块。"
          : "当前规则可确定单方或一致顺序，并在明确稳定间隔保留另一侧新增块；不是语义安全证明。"}
      </p>
      <details>
        <summary>{copyText("app/features/ScriptMergeOrderReview.4")}</summary>
        <p className={styles.c3}>
          {copyText("app/features/ScriptMergeOrderReview.5")}
          {merge.blockOrder.base.join(" → ")}
        </p>
        <p className={styles.c3}>
          {copyText("app/features/ScriptMergeOrderReview.6")}
          {merge.blockOrder.current.join(" → ")}
        </p>
        <p className={styles.c3}>
          {copyText("app/features/ScriptMergeOrderReview.7")}
          {merge.blockOrder.candidate.join(" → ")}
        </p>
      </details>
      <div className={styles.c4}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            onOrder(
              completeScriptMergeOrder(merge.blockOrder!.current, selected),
            )
          }
        >
          {copyText("app/features/ScriptMergeOrderReview.8")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            onOrder(
              completeScriptMergeOrder(merge.blockOrder!.candidate, selected),
            )
          }
        >
          {copyText("app/features/ScriptMergeOrderReview.9")}
        </Button>
      </div>
      <p className={styles.c5}>
        {copyText("app/features/ScriptMergeOrderReview.10")}
      </p>
      <ol className={styles.c6}>
        {order.map((id, index) => {
          const unit = merge.units.find((item) => item.id === id)!;
          const choice = choices[id] ?? unit.choice;
          return (
            <li key={id} className={styles.c7}>
              <p className={styles.c3}>
                {index + 1} · {id} ·{" "}
                {unit.kind ? changeLabels[unit.kind] : "历史未标记"} ·{" "}
                {choice === "main" ? "当前稿正文" : "AI 草稿正文"}
              </p>
              <p className={styles.c8}>
                {choice === "main" ? unit.current : unit.candidate}
              </p>
              <div className={styles.c9}>
                <Button
                  variant="secondary"
                  disabled={busy || index === 0}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, -1))}
                >
                  {copyText("app/features/ScriptMergeOrderReview.11")}
                  {index + 1}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || index === order.length - 1}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, 1))}
                >
                  {copyText("app/features/ScriptMergeOrderReview.12")}
                  {index + 1}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {manual && (
        <label className={styles.c10}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          {copyText("app/features/ScriptMergeOrderReview.13")}
        </label>
      )}
    </section>
  );
}
