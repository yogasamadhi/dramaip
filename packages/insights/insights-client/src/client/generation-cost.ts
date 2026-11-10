import type { GenerationRecord } from "@dramaip/insights-insights/types";
import type { zh } from "./locale.ts";

type Translate = (
  key: keyof typeof zh,
  values?: Record<string, string | number>,
) => string;

const SOURCE = {
  "configured-unit-estimate": "ledger.source.estimate",
  "human-declared": "ledger.source.declared",
  "legacy-unverified": "ledger.source.legacy",
  unspecified: "ledger.source.unknown",
} as const;

/**
 * One ledger record's cost line: where the figure comes from, the amount
 * and the unit as recorded, and that settlement is unknown. Never a total.
 * @param t - the insights copy.
 * @param record - the record, or the record with one observation in place.
 */
export function generationCostLabel(
  t: Translate,
  record: Pick<GenerationRecord, "actualCost" | "costObservation">,
): string {
  const observation = record.costObservation;
  if (!observation) {
    const amount = record.actualCost;
    return t("ledger.cost", {
      source: t("ledger.source.legacy"),
      amount:
        typeof amount === "number" && Number.isFinite(amount) && amount >= 0
          ? String(amount)
          : t("ledger.amount.unknown"),
      unit: t("ledger.unit.unknown"),
    });
  }
  return t("ledger.cost", {
    source: t(SOURCE[observation.source]),
    amount:
      observation.amount.status === "reported"
        ? String(observation.amount.value)
        : t(
            observation.amount.status === "invalid"
              ? "ledger.amount.invalid"
              : "ledger.amount.unknown",
          ),
    unit:
      observation.unit.status === "reported"
        ? observation.unit.value
        : t(
            observation.unit.status === "invalid"
              ? "ledger.unit.invalid"
              : "ledger.unit.unknown",
          ),
  });
}

/** A manual declaration, as the ledger writes it. */
export interface HumanCostPatch {
  readonly actualCost?: number;
  readonly currency?: string;
  readonly costNote: string;
}

/**
 * Read a manual declaration. A blank amount declares no new amount (not a
 * zero or a deletion) and a blank unit keeps no earlier one.
 * @returns the patch, or the key of the reason it is refused.
 */
export function humanCostPatch(
  amountText: string,
  unitText: string,
  note: string,
): HumanCostPatch | { readonly refused: keyof typeof zh } {
  const decimal = amountText.trim();
  const amount = decimal ? Number(decimal) : undefined;
  if (
    decimal &&
    (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(decimal) ||
      !Number.isFinite(amount) ||
      amount! < 0 ||
      (amount === 0 && /[1-9]/u.test(decimal.split(/e/iu)[0]!)))
  )
    return { refused: "ledger.declare.amountInvalid" };
  const unit = unitText.trim();
  if (unit.length > 12 || note.length > 2_000)
    return { refused: "ledger.declare.tooLong" };
  return {
    ...(amount === undefined ? {} : { actualCost: amount }),
    ...(unit ? { currency: unit } : {}),
    costNote: note,
  };
}
