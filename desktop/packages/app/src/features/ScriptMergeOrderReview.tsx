import { Button } from "@dramaip/ui-shared";
import type { CreationMerge } from "@dramaip/contracts/creation";
import {
  completeScriptMergeOrder,
  moveScriptMergeBlock,
  selectedScriptMergeIds,
} from "../script-merge-order";
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
    return <p>历史比较未提供块顺序协议，不补造位置或确认。</p>;
  const selected = selectedScriptMergeIds(merge, choices);
  const order = completeScriptMergeOrder(
    draft ?? merge.blockOrder.proposed,
    selected,
  );
  const manual = Boolean(draft) || merge.blockOrder.conflict;
  return (
    <section
      aria-label="剧本完整块顺序核对"
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <h4 className="font-semibold">完整块顺序与来源位置</h4>
      <p>
        {merge.blockOrder.conflict
          ? "排序存在冲突：不能猜测相对位置，须明确排列并确认全部保留块。"
          : "当前规则可确定单方或一致顺序，并在明确稳定间隔保留另一侧新增块；不是语义安全证明。"}
      </p>
      <details>
        <summary>核对原基准／当前稿／AI 草稿的稳定 ID 顺序</summary>
        <p className="break-all">原：{merge.blockOrder.base.join(" → ")}</p>
        <p className="break-all">
          当前：{merge.blockOrder.current.join(" → ")}
        </p>
        <p className="break-all">
          候选：{merge.blockOrder.candidate.join(" → ")}
        </p>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            onOrder(
              completeScriptMergeOrder(merge.blockOrder!.current, selected),
            )
          }
        >
          以当前块顺序为排序起点
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
          以 AI 草稿块顺序为排序起点
        </Button>
      </div>
      <p className="text-muted">
        排序起点不是采用决定：另一侧仅有的保留块会显示在列表末尾，请移动到明确位置；最终提交必须恰好包含全部所选稳定块。正文选择与排序分别核对，改变任一项会清除顺序确认。
      </p>
      <ol className="space-y-2">
        {order.map((id, index) => {
          const unit = merge.units.find((item) => item.id === id)!;
          const choice = choices[id] ?? unit.choice;
          return (
            <li key={id} className="space-y-1 rounded border border-line p-2">
              <p className="break-all">
                {index + 1} · {id} ·{" "}
                {unit.kind ? changeLabels[unit.kind] : "历史未标记"} ·{" "}
                {choice === "main" ? "当前稿正文" : "AI 草稿正文"}
              </p>
              <p className="whitespace-pre-wrap">
                {choice === "main" ? unit.current : unit.candidate}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || index === 0}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, -1))}
                >
                  上移合并块 {index + 1}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || index === order.length - 1}
                  onClick={() => onOrder(moveScriptMergeBlock(order, id, 1))}
                >
                  下移合并块 {index + 1}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {manual && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          我已逐项核对完整块顺序（含增删与位置）；不代表语义安全
        </label>
      )}
    </section>
  );
}
