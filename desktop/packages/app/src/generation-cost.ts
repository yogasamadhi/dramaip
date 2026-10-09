import type { GenerationRecord } from "@dramaip/contracts/insights";

export function generationCostLabel(record: GenerationRecord): string {
  const observation = record.costObservation;
  if (!observation) {
    const amount = record.actualCost;
    return `旧记录未认证 · ${typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? String(amount) : "金额未知"} · 单位未知 · 结算状态未知`;
  }
  const source = {
    "configured-unit-estimate": "配置单次估价（不是本次总费用）",
    "human-declared": "手工声明（未认证）",
    "legacy-unverified": "旧记录未认证",
    unspecified: "费用来源未知",
  }[observation.source];
  const amount =
    observation.amount.status === "reported"
      ? String(observation.amount.value)
      : observation.amount.status === "invalid"
        ? "金额无效"
        : "金额未知";
  const unit =
    observation.unit.status === "reported"
      ? observation.unit.value
      : observation.unit.status === "invalid"
        ? "单位无效"
        : "单位未知";
  return `${source} · ${amount} · ${unit} · 结算状态未知`;
}

export function configuredEstimateLabel(
  amount: unknown,
  unit: unknown,
): string {
  return `配置单次估价 ${typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? String(amount) : "金额未知"} · ${typeof unit === "string" && unit.trim() ? unit.trim() : "单位未知"}（非结算）`;
}

/** Blank means no new amount declaration, not a zero or deletion. */
export function humanCostPatch(
  amountText: string,
  unitText: string,
  note: string,
) {
  const decimal = amountText.trim();
  const amount = decimal ? Number(decimal) : undefined;
  if (
    decimal &&
    (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(decimal) ||
      !Number.isFinite(amount) ||
      amount! < 0 ||
      (amount === 0 && /[1-9]/u.test(decimal.split(/e/iu)[0]!)))
  )
    throw new Error("金额须为非负有限十进制数；留空不产生新金额声明。");
  const unit = unitText.trim();
  if (unit.length > 12 || note.length > 2_000)
    throw new Error("单位最多 12 字符，备注最多 2000 字符。");
  return {
    ...(amount === undefined ? {} : { actualCost: amount }),
    ...(unit ? { currency: unit } : {}),
    costNote: note,
  };
}
