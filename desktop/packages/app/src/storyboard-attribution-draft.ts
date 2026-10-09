import { z } from "zod";
import type { StudioClient } from "@dramaip/client";
import {
  StoryboardAttributionSourceSchema,
  StoryboardAttributionSelectionSchema,
  StoryboardAttributionCreateSchema,
  StoryboardAttributionDecisionSchema,
  StoryboardAttributionSchema,
  type StoryboardAttributionSource,
  type StoryboardAttributionSummary,
} from "@dramaip/contracts/production";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
export const StoryboardAttributionScopeSchema = z
  .object({
    projectId: z.string().uuid(),
    storyboard: ref,
  })
  .strict();
export type StoryboardAttributionScope = z.infer<
  typeof StoryboardAttributionScopeSchema
>;
export const ShotAttributionPendingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("create"),
      key: z.string().uuid(),
      input: StoryboardAttributionCreateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("decision"),
      key: z.string().uuid(),
      original: StoryboardAttributionSchema,
      input: StoryboardAttributionDecisionSchema,
    })
    .strict(),
]);
export type ShotAttributionPending = z.infer<
  typeof ShotAttributionPendingSchema
>;
export const ShotAttributionDraftSchema = z
  .object({
    scope: StoryboardAttributionScopeSchema,
    source: StoryboardAttributionSourceSchema.optional(),
    selections: z.array(StoryboardAttributionSelectionSchema).max(1000),
    selectedId: z.string().uuid().optional(),
    pending: ShotAttributionPendingSchema.optional(),
    rejectedRequests: z
      .array(
        z
          .object({
            request: ShotAttributionPendingSchema,
            status: z.union([
              z.literal(400),
              z.literal(404),
              z.literal(409),
              z.literal(412),
              z.literal(422),
            ]),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    const same = (source: StoryboardAttributionSource) =>
      source.projectId === draft.scope.projectId &&
      source.storyboard.id === draft.scope.storyboard.id &&
      source.storyboard.version === draft.scope.storyboard.version;
    const pending = draft.pending;
    if (
      (draft.source && !same(draft.source)) ||
      (pending?.kind === "create" &&
        (!draft.source ||
          JSON.stringify(pending.input) !==
            JSON.stringify({
              storyboard: draft.scope.storyboard,
              sourceFingerprint: draft.source.sourceFingerprint,
              baseAttributionId: draft.source.baseAttributionId,
              selections: draft.selections,
            }))) ||
      (pending?.kind === "decision" &&
        (!same(pending.original.source) ||
          pending.original.status !== "pending" ||
          pending.input.version !== pending.original.version ||
          pending.input.sourceFingerprint !==
            pending.original.source.sourceFingerprint ||
          pending.input.associationFingerprint !==
            pending.original.associationFingerprint))
    )
      ctx.addIssue({
        code: "custom",
        message: "原人工关联请求与冻结来源／候选不符，禁止重绑或换键。",
      });
  });
export type ShotAttributionDraft = z.infer<typeof ShotAttributionDraftSchema>;
export function storyboardAttributionDraftKey(
  scope: StoryboardAttributionScope,
) {
  return `dramaip-shot-attribution:${scope.projectId}:${scope.storyboard.id}:${scope.storyboard.version}`;
}
export function readStoryboardAttributionDraft(
  raw: string | null,
  scope: StoryboardAttributionScope,
): ShotAttributionDraft {
  if (raw === null) return { scope, selections: [] };
  const value = ShotAttributionDraftSchema.parse(JSON.parse(raw));
  if (
    JSON.stringify(value.scope) !==
    JSON.stringify(StoryboardAttributionScopeSchema.parse(scope))
  )
    throw new Error("本机原关联不属于此项目／正式版本，不恢复其他草稿。");
  return value;
}
/** Persist before HTTP, including the complete original decision snapshot. */
export function writeStoryboardAttributionDraft(
  storage: Pick<Storage, "setItem" | "getItem">,
  value: ShotAttributionDraft,
) {
  const parsed = ShotAttributionDraftSchema.parse(value),
    key = storyboardAttributionDraftKey(parsed.scope),
    raw = JSON.stringify(parsed);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("本机原请求未完整保存；未授权另造新键。");
  return parsed;
}
export function attributionSourceMatches(
  a: StoryboardAttributionSource | undefined,
  b: StoryboardAttributionSource | undefined,
) {
  return Boolean(
    a &&
    b &&
    a.projectId === b.projectId &&
    a.storyboard.id === b.storyboard.id &&
    a.storyboard.version === b.storyboard.version &&
    a.sourceFingerprint === b.sourceFingerprint &&
    a.baseAttributionId === b.baseAttributionId,
  );
}
/** Explicit metadata first, then exact formal quote/block bodies, then recheck. */
export async function readShotAttributionSourceReview(
  client: StudioClient,
  scope: StoryboardAttributionScope,
) {
  const source = await client.storyboardAttributions.sources(
    scope.projectId,
    scope.storyboard,
  );
  const [outline, script] = await Promise.all([
    client.episodeDevelopments.get(source.outline.id),
    client.episodeDevelopments.get(source.script.id),
  ]);
  for (const [value, expected, operation] of [
    [outline, source.outline, "episode-outline"],
    [script, source.script, "episode-script"],
  ] as const) {
    if (
      value.projectId !== scope.projectId ||
      value.episodeId !== source.episodeId ||
      value.id !== expected.id ||
      value.version !== expected.version ||
      value.sourceSnapshotId !== expected.sourceSnapshotId ||
      value.operation !== operation ||
      !value.isCurrent ||
      value.sourceState !== "current"
    )
      throw new Error("实际引文／剧本块不属于明确正式链，不用旧缓存代替。");
  }
  if (
    outline.content.kind !== "episode-outline" ||
    script.content.kind !== "episode-script" ||
    JSON.stringify(outline.sourceEvidence) !==
      JSON.stringify(source.evidence) ||
    JSON.stringify(
      script.content.value.blocks.map((block, index) => ({
        id: block.id,
        index,
        type: block.type,
      })),
    ) !== JSON.stringify(source.scriptBlocks)
  )
    throw new Error("实际表达与规则位置／稳定块未核全，不确认关联。");
  const current = await client.storyboardAttributions.sources(
    scope.projectId,
    scope.storyboard,
  );
  if (!attributionSourceMatches(source, current))
    throw new Error("审阅期间实际来源或关联头已改变，原草稿保留。");
  return {
    source,
    outline: outline.content.value,
    script: script.content.value,
  };
}
export type ShotAttributionSourceReview = Awaited<
  ReturnType<typeof readShotAttributionSourceReview>
>;
/** Full cursor traversal, including repeated/nonadvancing and duplicate-ID failures. */
export async function readAllShotAttributionSummaries(
  client: StudioClient,
  projectId: string,
) {
  const values: StoryboardAttributionSummary[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.storyboardAttributions.summaries(projectId, {
      cursor,
      limit: 100,
    });
    for (const value of page.items) {
      if (ids.has(value.id)) throw new Error("关联历史身份重复，未核全。");
      ids.add(value.id);
      values.push(value);
    }
    cursor = page.nextCursor;
    if (cursor && (!page.items.length || cursors.has(cursor)))
      throw new Error("关联历史分页未推进，未选最近记录替代。");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return values;
}
