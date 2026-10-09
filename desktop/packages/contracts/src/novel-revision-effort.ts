import { z } from "zod";
import {
  CreativeFunnelRecordSchema,
  canonicalCreativeMetricJSON,
} from "./creative-funnel.js";
import { CreativeOutcomeRecordSchema } from "./creative-outcomes.js";

export const NOVEL_REVISION_EVENT =
  "automation.chapter-candidate-revision-recorded.v1";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const NovelRevisionFactSchema = z
  .object({
    eventVersion: z.literal(1),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    workflowVersion: z.number().int().nonnegative(),
    targetKey: hash,
    chapterId: z.string().uuid(),
    previewId: z.string().uuid(),
    rootPreviewId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.enum(["initial", "content-update", "rebase"]),
    coverage: z.enum(["complete", "partial"]),
    beforeFingerprint: hash.optional(),
    afterFingerprint: hash,
    sourcePreviewId: z.string().uuid().optional(),
    evidenceKind: z.literal("rule"),
    qualityState: z.literal("unverified"),
  })
  .strict()
  .superRefine((f, c) => {
    if (
      f.kind === "initial"
        ? f.sequence !== 0 ||
          f.beforeFingerprint !== undefined ||
          f.sourcePreviewId !== undefined ||
          f.rootPreviewId !== f.previewId
        : f.kind === "content-update"
          ? f.sequence === 0 ||
            !f.beforeFingerprint ||
            f.beforeFingerprint === f.afterFingerprint ||
            f.sourcePreviewId !== undefined
          : f.sequence !== 0 ||
            !f.beforeFingerprint ||
            !f.sourcePreviewId ||
            f.sourcePreviewId === f.previewId
    )
      c.addIssue({
        code: "custom",
        message:
          "Revision facts must identify an actual original baseline or saved change.",
      });
  });
export const NovelRevisionRecordSchema = z
  .object({
    fact: NovelRevisionFactSchema,
    eventId: z.string().uuid(),
    cursor: z.number().int().positive(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type NovelRevisionFact = z.infer<typeof NovelRevisionFactSchema>;
export type NovelRevisionRecord = z.infer<typeof NovelRevisionRecordSchema>;
export const NovelRevisionMeasureSchema = z
  .object({
    targetKey: hash,
    workflowIds: z.array(z.string().uuid()).min(1),
    state: z.enum(["measured", "unknown", "pending"]),
    localRevisionCount: z.number().int().nonnegative().nullable(),
    observedContentUpdates: z.number().int().nonnegative(),
    observedRebases: z.number().int().nonnegative(),
    observedContentChangingRebases: z.number().int().nonnegative(),
    adoption: z
      .object({
        eventId: z.string().uuid(),
        cursor: z.number().int().positive(),
        workflowId: z.string().uuid().optional(),
        previewId: z.string().uuid().optional(),
        chapterId: z.string().uuid(),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.workflowIds).size !== v.workflowIds.length ||
      v.observedContentChangingRebases > v.observedRebases ||
      (v.state === "measured"
        ? !v.adoption ||
          v.localRevisionCount !==
            v.observedContentUpdates + v.observedContentChangingRebases
        : v.localRevisionCount !== null) ||
      (v.state === "pending") !== (v.adoption === null) ||
      (v.state === "measured" &&
        v.adoption &&
        (!v.adoption.workflowId ||
          !v.workflowIds.includes(v.adoption.workflowId)))
    )
      c.addIssue({
        code: "custom",
        message:
          "Unadopted or incomplete history cannot establish adoption revision effort.",
      });
  });
export const NovelRevisionEffortPageSchema = z
  .object({
    format: z.literal("novel-revision-effort-page-v1"),
    projectId: z.string().uuid(),
    projection: z
      .object({
        state: z.enum(["healthy", "catching-up", "retrying", "degraded"]),
        checkpoint: z.number().int().nonnegative(),
      })
      .strict(),
    totalTargets: z.number().int().nonnegative(),
    items: z.array(NovelRevisionMeasureSchema).max(100),
    nextCursor: z.string().min(1).max(1024).optional(),
    policy: z.literal(
      "saved-content-changes-before-first-recorded-formal-adoption",
    ),
    modelRevisions: z.literal("excluded"),
    qualityState: z.literal("unverified"),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.totalTargets < v.items.length ||
      v.items.some(
        (r, i) => i > 0 && r.targetKey >= v.items[i - 1]!.targetKey,
      ) ||
      v.items.some(
        (r) => r.adoption && r.adoption.cursor > v.projection.checkpoint,
      ) ||
      (v.nextCursor && !v.items.length)
    )
      c.addIssue({
        code: "custom",
        message:
          "Revision pages must retain exact sorted targets and the original checkpoint.",
      });
  });
export type NovelRevisionEffortPage = z.infer<
  typeof NovelRevisionEffortPageSchema
>;

/** Full owned history at one event checkpoint, not current mutable previews. */
export function measureNovelRevisionEffort(
  projectId: string,
  funnel: readonly unknown[],
  outcomes: readonly unknown[],
  revisions: readonly unknown[],
) {
  const fs = funnel.map((x) => CreativeFunnelRecordSchema.parse(x)),
    os = outcomes.map((x) => CreativeOutcomeRecordSchema.parse(x)),
    rs = revisions.map((x) => NovelRevisionRecordSchema.parse(x));
  if (
    fs.some((x) => x.fact.projectId !== projectId) ||
    os.some((x) => x.projectId !== projectId) ||
    rs.some((x) => x.fact.projectId !== projectId)
  )
    throw new Error("Revision history cannot mix projects.");
  const identities = [...fs, ...os, ...rs];
  if (
    new Set(identities.map((r) => r.eventId)).size !== identities.length ||
    new Set(identities.map((r) => r.cursor)).size !== identities.length
  )
    throw new Error(
      "Original event identities and cursors cannot repeat across revision history.",
    );
  const requests = fs
    .flatMap((x) =>
      x.fact.kind === "request" && x.fact.metric === "novel.chapter"
        ? [{ ...x, fact: x.fact }]
        : [],
    )
    .sort((a, b) => a.cursor - b.cursor);
  if (
    rs.some(
      (r) =>
        !requests.some(
          (q) =>
            q.fact.workflowId === r.fact.workflowId &&
            q.fact.targetKey === r.fact.targetKey &&
            q.cursor < r.cursor,
        ),
    )
  )
    throw new Error(
      "Revision observations require their exact original request scope.",
    );
  const groups = new Map<string, typeof requests>();
  for (const r of requests)
    groups.set(r.fact.targetKey, [...(groups.get(r.fact.targetKey) ?? []), r]);
  return [...groups]
    .map(([targetKey, reqs]) => {
      const ids = reqs.map((r) => r.fact.workflowId),
        idSet = new Set(ids);
      const chapters = new Set([
        ...rs
          .filter((r) => r.fact.targetKey === targetKey)
          .map((r) => r.fact.chapterId),
        ...os
          .filter(
            (o) =>
              o.kind === "novel.chapter-adopted" &&
              o.workflowId &&
              idSet.has(o.workflowId),
          )
          .map((o) => o.objectId),
      ]);
      if (chapters.size > 1)
        throw new Error(
          "An original chapter target cannot change its chapter identity.",
        );
      const adopt = os
        .filter(
          (o) => o.kind === "novel.chapter-adopted" && chapters.has(o.objectId),
        )
        .sort((a, b) => a.cursor - b.cursor)[0];
      const changes = rs
        .filter(
          (r) =>
            r.fact.targetKey === targetKey &&
            idSet.has(r.fact.workflowId) &&
            (!adopt || r.cursor < adopt.cursor),
        )
        .sort((a, b) => a.cursor - b.cursor);
      const states = new Map<string, NovelRevisionRecord>();
      const first = reqs[0]!.fact;
      let complete = first.kind === "request" && first.targetAttempt === 1,
        updates = 0,
        rebases = 0,
        changed = 0;
      const eventIds = new Set<string>(),
        identities = new Set<string>();
      for (const r of changes) {
        const f = r.fact,
          identity = canonicalCreativeMetricJSON([f.previewId, f.sequence]);
        if (eventIds.has(r.eventId) || identities.has(identity))
          throw new Error("Duplicate candidate revision observation.");
        eventIds.add(r.eventId);
        identities.add(identity);
        const request = reqs.find((x) => x.fact.workflowId === f.workflowId);
        if (!request || request.cursor >= r.cursor)
          throw new Error("A revision requires its original earlier request.");
        if (f.coverage !== "complete") complete = false;
        const prior = states.get(f.previewId);
        if (f.kind === "initial") {
          if (prior)
            throw new Error("A candidate baseline cannot be replaced.");
        } else if (f.kind === "content-update") {
          updates++;
          if (!prior) complete = false;
          else if (
            prior.fact.sequence + 1 !== f.sequence ||
            prior.fact.afterFingerprint !== f.beforeFingerprint ||
            prior.fact.rootPreviewId !== f.rootPreviewId
          )
            throw new Error("The original revision sequence is broken.");
        } else {
          rebases++;
          if (f.beforeFingerprint !== f.afterFingerprint) changed++;
          const source = states.get(f.sourcePreviewId!);
          if (!source) complete = false;
          else if (
            source.fact.afterFingerprint !== f.beforeFingerprint ||
            source.fact.rootPreviewId !== f.rootPreviewId ||
            source.fact.workflowId !== f.workflowId
          )
            throw new Error("The original rebase source is inconsistent.");
        }
        states.set(f.previewId, r);
      }
      for (const c of fs
        .flatMap((x) =>
          x.fact.kind === "candidate-ready" && x.fact.metric === "novel.chapter"
            ? [{ ...x, fact: x.fact }]
            : [],
        )
        .filter(
          (x) =>
            x.fact.kind === "candidate-ready" &&
            x.fact.targetKey === targetKey &&
            (!adopt || x.cursor < adopt.cursor),
        )) {
        const candidate = c.fact.candidate;
        const baseline = changes.find(
          (r) => r.fact.previewId === candidate.id && r.fact.kind === "initial",
        );
        if (!baseline) complete = false;
        else if (
          baseline.fact.afterFingerprint !== c.fact.candidate.contentFingerprint
        )
          throw new Error(
            "Original candidate baseline fingerprint is inconsistent.",
          );
      }
      const formal = adopt?.formalVersions.filter(
        (v) => v.kind === "chapter" && v.id === adopt.objectId,
      );
      if (adopt && formal?.length !== 1)
        throw new Error(
          "The formal adoption chapter version cannot be inferred.",
        );
      if (adopt) {
        const final = adopt.candidate && states.get(adopt.candidate.id);
        if (
          !adopt.workflowId ||
          !idSet.has(adopt.workflowId) ||
          !adopt.candidate ||
          !final ||
          final.fact.afterFingerprint !== adopt.candidate.contentFingerprint ||
          final.fact.workflowId !== adopt.workflowId ||
          final.fact.chapterId !== adopt.objectId ||
          formal?.length !== 1
        )
          complete = false;
      }
      return NovelRevisionMeasureSchema.parse({
        targetKey,
        workflowIds: ids,
        state: !adopt ? "pending" : complete ? "measured" : "unknown",
        localRevisionCount: adopt && complete ? updates + changed : null,
        observedContentUpdates: updates,
        observedRebases: rebases,
        observedContentChangingRebases: changed,
        adoption: adopt
          ? {
              eventId: adopt.eventId,
              cursor: adopt.cursor,
              ...(adopt.workflowId ? { workflowId: adopt.workflowId } : {}),
              ...(adopt.candidate ? { previewId: adopt.candidate.id } : {}),
              chapterId: adopt.objectId,
              version: formal![0]!.version,
            }
          : null,
      });
    })
    .sort((a, b) => (a.targetKey > b.targetKey ? -1 : 1));
}
