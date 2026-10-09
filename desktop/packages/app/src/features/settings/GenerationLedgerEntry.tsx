import type { GenerationRecord } from "@dramaip/contracts/insights";
import { BareButton } from "@dramaip/ui-shared";
import { useState } from "react";
import { generationCostLabel, humanCostPatch } from "../../generation-cost";

export function GenerationLedgerEntry({
  record,
  save,
}: {
  record: GenerationRecord;
  save: (patch: ReturnType<typeof humanCostPatch>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState(record.costNote ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <article className="rounded-lg border border-line p-3 text-sm">
      <p className="font-medium">{record.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted">{record.summary}</p>
      <p className="mt-1 text-xs text-muted">{generationCostLabel(record)}</p>
      <p className="mt-1 text-xs text-muted">
        独立费用观察 {record.costObservationCount ?? "未知"} 条，不合计。
        {record.costNote}
      </p>
      {!editing ? (
        <BareButton
          className="mt-2 rounded-md border border-line px-2 py-1 text-xs text-brand"
          onClick={() => {
            setAmount("");
            setUnit("");
            setNote(record.costNote ?? "");
            setEditing(true);
            setNotice("");
          }}
        >
          补录费用声明
        </BareButton>
      ) : (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            let patch: ReturnType<typeof humanCostPatch>;
            try {
              patch = humanCostPatch(amount, unit, note);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "声明无效");
              return;
            }
            setPending(true);
            void save(patch)
              .then(() => {
                setEditing(false);
                setNotice("已保存手工声明；尚未认证结算凭证。");
              })
              .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : "保存失败");
              })
              .finally(() => setPending(false));
          }}
        >
          <p className="text-xs text-muted">
            原记录 {record.id}
            。金额留空只更新备注，不清除或补零；单位留空不沿用旧币种。手工声明不是服务商结算认证。
          </p>
          <label>
            声明金额
            <input
              aria-label="声明金额"
              className="ml-2 rounded border border-line px-2 py-1"
              value={amount}
              disabled={pending}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            声明单位
            <input
              aria-label="声明单位"
              className="ml-2 rounded border border-line px-2 py-1"
              value={unit}
              disabled={pending}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
          <label>
            声明备注
            <textarea
              aria-label="声明备注"
              className="mt-1 w-full rounded border border-line p-2"
              value={note}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-line px-2 py-1"
            >
              {pending ? "保存中" : "保存未认证声明"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
              className="rounded border border-line px-2 py-1"
            >
              取消
            </button>
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-muted">
          {notice}
        </p>
      )}
    </article>
  );
}
