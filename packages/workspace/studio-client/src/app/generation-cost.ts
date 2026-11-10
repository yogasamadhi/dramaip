export function configuredEstimateLabel(
  amount: unknown,
  unit: unknown,
): string {
  return `配置单次估价 ${typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? String(amount) : "金额未知"} · ${typeof unit === "string" && unit.trim() ? unit.trim() : "单位未知"}（非结算）`;
}
