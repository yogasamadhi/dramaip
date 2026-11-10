import { z } from "zod";
import { defineServiceContract } from "./service-contract.js";
import { StorySourceLifecycleSummarySchema } from "./story-source-lifecycle.js";

const ref = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
/** The persisted shot binding hashes canonical JSON, not insertion-order JSON.
 * This serializer does not expose text; only its SHA-256 is observation output. */
export function canonicalStoryNodeReferenceJSON(
  value: unknown,
  depth = 0,
): string {
  if (depth > 100) throw new Error("实际节点引用层级超限。");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalStoryNodeReferenceJSON(item, depth + 1)).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalStoryNodeReferenceJSON((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(",")}}`;
  throw new Error("实际节点引用不是完整可保存的 JSON。");
}
export const StoryNodeObservationSelectionSchema = z
  .object({
    declaration: ref,
    node: ref,
  })
  .strict();
export const StoryNodeObservationReasonSchema = z.enum([
  "declaration-missing",
  "declaration-not-adopted",
  "declaration-version-changed",
  "declaration-node-binding-changed",
  "node-missing",
  "node-version-changed",
  "node-fields-changed",
  "node-unconfirmed",
  "node-retired",
  "node-lifecycle-withdrawn",
  "node-lifecycle-replaced",
  "declaration-source-stale",
  "declaration-source-unavailable",
]);
/** Exact owner metadata, not node bodies, retirement reasons or semantic safety. */
export const StoryNodeObservationSchema = z
  .object({
    format: z.literal("exact-story-node-owner-observation-v1"),
    projectId: z.string().uuid(),
    requested: StoryNodeObservationSelectionSchema,
    declaration: z
      .object({
        id: ref.shape.id,
        version: ref.shape.version,
        status: z.enum(["pending", "adopted", "discarded"]),
        adoptedNode: ref.nullable(),
        sourceState: z.enum(["current", "stale", "unavailable"]),
        contentHash: sha,
      })
      .strict()
      .nullable(),
    node: z
      .object({
        id: ref.shape.id,
        version: ref.shape.version,
        retired: z.boolean(),
        confirmed: z.boolean(),
        contentHash: sha,
      })
      .strict()
      .nullable(),
    lifecycle: StorySourceLifecycleSummarySchema.nullable(),
    // SHA-256 of canonicalStoryNodeReferenceJSON(actual nodeReference).
    referenceHash: sha.nullable(),
    reasonCodes: z.array(StoryNodeObservationReasonSchema).max(13),
    semanticVerification: z.literal("unverified"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const d = value.declaration,
      n = value.node,
      expected = value.requested;
    const includes = (
      reason: z.infer<typeof StoryNodeObservationReasonSchema>,
    ) => value.reasonCodes.includes(reason);
    const inconsistentReasons = (
      [
        ["declaration-missing", !d],
        ["declaration-not-adopted", Boolean(d && d.status !== "adopted")],
        [
          "declaration-version-changed",
          Boolean(d && d.version !== expected.declaration.version),
        ],
        [
          "declaration-node-binding-changed",
          Boolean(
            d &&
            (d.adoptedNode?.id !== expected.node.id ||
              d.adoptedNode?.version !== expected.node.version),
          ),
        ],
        ["declaration-source-stale", d?.sourceState === "stale"],
        ["declaration-source-unavailable", d?.sourceState === "unavailable"],
        ["node-missing", !n],
        [
          "node-version-changed",
          Boolean(n && n.version !== expected.node.version),
        ],
        ["node-unconfirmed", Boolean(n && !n.confirmed)],
        ["node-retired", Boolean(n?.retired)],
        ["node-lifecycle-withdrawn", value.lifecycle?.state === "withdrawn"],
        ["node-lifecycle-replaced", value.lifecycle?.state === "replaced"],
      ] as const
    ).some(([reason, required]) => includes(reason) !== required);
    if (
      inconsistentReasons ||
      (includes("node-fields-changed") && (!d || !n)) ||
      (d && d.id !== expected.declaration.id) ||
      (n && n.id !== expected.node.id) ||
      new Set(value.reasonCodes).size !== value.reasonCodes.length ||
      (!d &&
        (value.lifecycle ||
          !value.reasonCodes.includes("declaration-missing"))) ||
      (!n && !value.reasonCodes.includes("node-missing")) ||
      (value.lifecycle &&
        (value.lifecycle.record.kind !== "node" ||
          value.lifecycle.record.id !== d?.adoptedNode?.id)) ||
      (value.referenceHash !== null &&
        (!d ||
          !n ||
          d.status !== "adopted" ||
          d.version !== expected.declaration.version ||
          n.version !== expected.node.version ||
          d.adoptedNode?.id !== n.id ||
          d.adoptedNode.version !== n.version ||
          d.sourceState !== "current" ||
          n.retired ||
          !n.confirmed ||
          value.lifecycle?.state !== "active" ||
          value.reasonCodes.length !== 0)) ||
      (value.reasonCodes.length === 0) !== (value.referenceHash !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "原节点观察的身份、实际生命周期或读取状态不一致。",
      });
  });
export type StoryNodeObservationSelection = z.infer<
  typeof StoryNodeObservationSelectionSchema
>;
export type StoryNodeObservation = z.infer<typeof StoryNodeObservationSchema>;
export const KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE = defineServiceContract<{
  observe(
    projectId: string,
    requested: StoryNodeObservationSelection,
  ): StoryNodeObservation;
}>({
  id: "knowledge.story-node-observations.v1",
  owner: "knowledge",
  major: 1,
  capabilities: ["read"],
  degradable: true,
});
