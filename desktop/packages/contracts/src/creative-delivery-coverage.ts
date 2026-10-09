import { z } from "zod";
import {
  CreativeOutcomeKindSchema,
  CreativeOutcomePageSchema,
  CreativeOutcomeRecordSchema,
  CreativeOutcomeSummarySchema,
  type CreativeOutcomePage,
  type CreativeOutcomeRecord,
  type CreativeOutcomeSummary,
} from "./creative-outcomes.js";
import { canonicalCreativeMetricJSON } from "./creative-funnel.js";

const version = z
  .object({
    kind: z.enum(["chapter", "episode-script"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const event = z
  .object({
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
  })
  .strict();
const row = z
  .object({
    formalVersion: version,
    adoption: event,
    firstSaved: event
      .extend({
        objectId: z.string().uuid(),
        receipt: CreativeOutcomeRecordSchema.shape.receipt.unwrap(),
      })
      .strict()
      .nullable(),
    savedUnits: z.number().int().nonnegative(),
  })
  .strict();
const group = z
  .object({
    workflowPath: z.enum(["novel", "adaptation"]),
    adoptedVersions: z.number().int().nonnegative(),
    deliveredVersions: z.number().int().nonnegative(),
    notSavedVersions: z.number().int().nonnegative(),
    ratio: z
      .object({
        numerator: z.number().int().nonnegative(),
        denominator: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    items: z.array(row),
    savedVersionsWithoutEarlierAdoption: z.array(version),
  })
  .strict();
const key = (value: z.infer<typeof version>) =>
  canonicalCreativeMetricJSON(value);
export const CreativeDeliveryCoverageSchema = z
  .object({
    format: z.literal("creative-delivery-coverage-v1"),
    projectId: z.string().uuid(),
    projection: CreativeOutcomeSummarySchema.shape.projection,
    historyPolicy: z.literal("complete-recorded-owner-facts-only"),
    policy: z.literal("exact-formal-version-save-after-recorded-adoption"),
    qualityState: z.literal("unverified"),
    modelEvidence: z.literal("unknown"),
    groups: z.array(group).length(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.projection.state !== "healthy" ||
      value.groups.some((g, i) => {
        const kind = i === 0 ? "chapter" : "episode-script",
          saved = g.items.filter((r) => r.firstSaved !== null).length,
          keys = g.items.map((r) => key(r.formalVersion)),
          unlinked = g.savedVersionsWithoutEarlierAdoption.map(key),
          delivered = new Set(
            g.items
              .filter((r) => r.firstSaved)
              .map((r) => key(r.formalVersion)),
          );
        return (
          g.workflowPath !== (i === 0 ? "novel" : "adaptation") ||
          g.adoptedVersions !== g.items.length ||
          g.deliveredVersions !== saved ||
          g.notSavedVersions !== g.items.length - saved ||
          (g.ratio === null
            ? g.items.length !== 0
            : g.ratio.denominator !== g.items.length ||
              g.ratio.numerator !== saved) ||
          new Set(keys).size !== keys.length ||
          new Set(unlinked).size !== unlinked.length ||
          g.savedVersionsWithoutEarlierAdoption.some(
            (r) => r.kind !== kind || delivered.has(key(r)),
          ) ||
          g.items.some(
            (r) =>
              r.formalVersion.kind !== kind ||
              r.adoption.cursor > value.projection.checkpoint ||
              (r.firstSaved
                ? r.savedUnits < 1 ||
                  r.firstSaved.cursor <= r.adoption.cursor ||
                  r.firstSaved.cursor > value.projection.checkpoint ||
                  r.firstSaved.eventId === r.adoption.eventId
                : r.savedUnits !== 0),
          )
        );
      })
    )
      ctx.addIssue({
        code: "custom",
        message:
          "交付覆盖须保留同一原正式版本、此前采用、实际保存和完整分母，不能认证质量。",
      });
  });
export type CreativeDeliveryCoverage = z.infer<
  typeof CreativeDeliveryCoverageSchema
>;
export interface CreativeDeliveryCoverageInput {
  projection: CreativeOutcomeSummary["projection"];
  counts: CreativeOutcomeSummary["counts"];
  pages: readonly CreativeOutcomePage[];
}

/** Only exact complete owner ledgers; no title matching, current-head inference or quality pass. */
export function measureCreativeDeliveryCoverage(
  projectId: string,
  input: CreativeDeliveryCoverageInput,
): CreativeDeliveryCoverage {
  const reject = (): never => {
    throw new Error("原采用交付台账不完整或检查点／身份变化，请明确重新读取。");
  };
  const projection = CreativeOutcomeSummarySchema.shape.projection.parse(
    input.projection,
  );
  if (projection.state !== "healthy" || !input.pages.length) reject();
  const pages = input.pages.map((p) => CreativeOutcomePageSchema.parse(p)),
    events: CreativeOutcomeRecord[] = [],
    ids = new Set<string>(),
    fingerprints = new Map<string, string>(),
    units = new Map<
      string,
      { kind: CreativeOutcomeRecord["kind"]; fingerprint: string }
    >();
  let last = Infinity;
  pages.forEach((p, i) => {
    if (
      p.projectId !== projectId ||
      (p.nextCursor !== undefined) !== i < pages.length - 1 ||
      (i > 0 && !p.items.length) ||
      (!p.items.length && p.nextCursor !== undefined)
    )
      reject();
    for (const r of p.items) {
      if (
        r.projectId !== projectId ||
        r.cursor >= last ||
        r.cursor > projection.checkpoint ||
        ids.has(r.eventId)
      )
        reject();
      ids.add(r.eventId);
      last = r.cursor;
      events.push(r);
      const fingerprint = canonicalCreativeMetricJSON([
          r.kind,
          r.formalVersions.map((v) => canonicalCreativeMetricJSON(v)).sort(),
        ]),
        old = units.get(r.unitKey);
      if (old && old.fingerprint !== fingerprint) reject();
      if (
        fingerprints.has(fingerprint) &&
        fingerprints.get(fingerprint) !== r.unitKey
      )
        reject();
      fingerprints.set(fingerprint, r.unitKey);
      units.set(r.unitKey, { kind: r.kind, fingerprint });
    }
    if (p.nextCursor !== undefined && p.nextCursor !== last) reject();
  });
  if (
    events.length > 100_000 ||
    input.counts.length !== CreativeOutcomeKindSchema.options.length ||
    new Set(input.counts.map((c) => c.kind)).size !== input.counts.length
  )
    reject();
  for (const kind of CreativeOutcomeKindSchema.options) {
    const count = input.counts.find((c) => c.kind === kind);
    if (
      !count ||
      count.total !== [...units.values()].filter((u) => u.kind === kind).length
    )
      reject();
  }
  events.reverse();
  const stamp = (r: CreativeOutcomeRecord) => ({
    eventId: r.eventId,
    cursor: r.cursor,
    occurredAt: r.occurredAt,
  });
  const groups = (["novel", "adaptation"] as const).map((workflowPath) => {
    const adoptionKind =
        workflowPath === "novel"
          ? "novel.chapter-adopted"
          : "adaptation.script-adopted",
      saveKind =
        workflowPath === "novel"
          ? "novel.manuscript-exported"
          : "adaptation.pilot-package-exported",
      formalKind = workflowPath === "novel" ? "chapter" : "episode-script",
      adopted = new Map<
        string,
        { row: z.infer<typeof row>; units: Set<string> }
      >(),
      saved = new Map<string, z.infer<typeof version>>();
    for (const r of events) {
      if (r.kind === adoptionKind) {
        const formalVersion = version.parse(r.formalVersions[0]),
          k = key(formalVersion);
        if (!adopted.has(k))
          adopted.set(k, {
            row: {
              formalVersion,
              adoption: stamp(r),
              firstSaved: null,
              savedUnits: 0,
            },
            units: new Set(),
          });
      } else if (r.kind === saveKind) {
        for (const v of r.formalVersions.filter((v) => v.kind === formalKind)) {
          const formalVersion = version.parse(v),
            k = key(formalVersion),
            a = adopted.get(k);
          saved.set(k, formalVersion);
          if (!a) continue;
          a.units.add(r.unitKey);
          a.row.savedUnits = a.units.size;
          a.row.firstSaved ??= {
            ...stamp(r),
            objectId: r.objectId,
            receipt: r.receipt!,
          };
        }
      }
    }
    const items = [...adopted.values()]
        .map((a) => a.row)
        .sort((a, b) =>
          key(a.formalVersion).localeCompare(key(b.formalVersion)),
        ),
      deliveredVersions = items.filter((r) => r.firstSaved).length;
    return {
      workflowPath,
      adoptedVersions: items.length,
      deliveredVersions,
      notSavedVersions: items.length - deliveredVersions,
      ratio: items.length
        ? { numerator: deliveredVersions, denominator: items.length }
        : null,
      items,
      savedVersionsWithoutEarlierAdoption: [...saved.entries()]
        .filter(([k]) => !adopted.get(k)?.row.firstSaved)
        .map(([, v]) => v)
        .sort((a, b) => key(a).localeCompare(key(b))),
    };
  });
  return CreativeDeliveryCoverageSchema.parse({
    format: "creative-delivery-coverage-v1",
    projectId,
    projection,
    historyPolicy: "complete-recorded-owner-facts-only",
    policy: "exact-formal-version-save-after-recorded-adoption",
    qualityState: "unverified",
    modelEvidence: "unknown",
    groups,
  });
}
