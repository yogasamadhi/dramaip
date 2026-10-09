import { z } from "zod";
import { CreativeInitialGoalSummarySchema } from "./creative-goals.js";
import { CreativeSourceConfirmationSummarySchema } from "./creative-sources.js";
import {
  CreativePlanningAdoptionSummarySchema,
  CreativePlanningFunnelSummarySchema,
} from "./creative-planning.js";
import { CreativeQualityAdoptionRecordSchema } from "./creative-quality-associations.js";
import {
  CreativeContinuationTargetSchema,
  CreativeContinuationSummarySchema,
} from "./creative-continuation.js";
import {
  CreativeCandidateIdentitySchema,
  CreativeSelectionOptionSchema,
  CreativeFunnelSummarySchema,
} from "./creative-funnel.js";

/** Local owner facts, not telemetry, model evaluations or editable dashboards. */
export const CREATIVE_OUTCOME_EVENTS = {
  "writing.chapter-adopted.v1": "novel.chapter-adopted",
  "writing.planning-adopted.v1": "novel.planning-adopted",
  "knowledge.chapter-memory-written.v1": "novel.chapter-memory-written",
  "production.diagnosis-result-adopted.v1": "adaptation.diagnosis-adopted",
  "production.adaptation-strategy-result-adopted.v1":
    "adaptation.strategy-adopted",
  "production.season-plan-result-adopted.v1": "adaptation.season-plan-adopted",
  "production.script-result-adopted.v1": "adaptation.script-adopted",
  "delivery.manuscript-exported.v1": "novel.manuscript-exported",
  "delivery.pilot-package-exported.v1": "adaptation.pilot-package-exported",
} as const;
export const CreativeOutcomeKindSchema = z.enum([
  "novel.chapter-adopted",
  "novel.planning-adopted",
  "novel.chapter-memory-written",
  "novel.manuscript-exported",
  "adaptation.diagnosis-adopted",
  "adaptation.strategy-adopted",
  "adaptation.season-plan-adopted",
  "adaptation.script-adopted",
  "adaptation.pilot-package-exported",
]);
const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
export const CreativeOutcomeVersionSchema = ref
  .extend({
    kind: z.enum([
      "chapter",
      "planning",
      "knowledge-record",
      "diagnosis",
      "adaptation-strategy",
      "season-plan",
      "episode-script",
      "episode-outline",
      "storyboard",
      "script-document",
      "production-record",
    ]),
  })
  .strict();
const receipt = z
  .object({
    artifactRef: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteSize: z.number().int().nonnegative(),
    savedAt: z.string().datetime(),
  })
  .strict();
const memoryWrite = z
  .object({
    source: ref
      .extend({
        contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    records: z
      .array(
        ref
          .extend({
            version: z.literal(0),
            kind: z.enum([
              "chapter-memories",
              "character-states",
              "story-events",
              "foreshadowings",
            ]),
            contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const CreativeOutcomeFactSchema = z
  .object({
    eventVersion: z.literal(1),
    kind: CreativeOutcomeKindSchema,
    workflowPath: z.enum(["novel", "adaptation"]),
    projectId: z.string().uuid(),
    objectId: z.string().uuid(),
    workflowId: z.string().uuid().optional(),
    candidate: CreativeCandidateIdentitySchema.optional(),
    selectedOption: CreativeSelectionOptionSchema.optional(),
    memoryWrite: memoryWrite.optional(),
    continuationTarget: CreativeContinuationTargetSchema.optional(),
    formalVersions: z.array(CreativeOutcomeVersionSchema).min(1),
    sourceVersions: z.array(ref),
    evidenceKind: z.enum(["human", "rule"]),
    // A human adoption / byte receipt does not establish how a model was run.
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    resultStatus: z.enum(["adopted", "saved", "written"]),
    receipt: receipt.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const strategy = value.kind === "adaptation.strategy-adopted";
    if (
      strategy
        ? !value.candidate?.selectionOptions ||
          !value.selectedOption ||
          !value.candidate.selectionOptions.some(
            (option) =>
              option.id === value.selectedOption!.id &&
              option.contentFingerprint ===
                value.selectedOption!.contentFingerprint,
          )
        : Boolean(value.selectedOption || value.candidate?.selectionOptions)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Strategy owner facts must identify exactly one original candidate option; other outcomes cannot carry option selection.",
      });
    const saved = value.kind.endsWith("-exported");
    const written = value.kind === "novel.chapter-memory-written";
    if (
      value.workflowPath !== value.kind.split(".")[0] ||
      value.resultStatus !==
        (saved ? "saved" : written ? "written" : "adopted") ||
      value.evidenceKind !== (saved || written ? "rule" : "human") ||
      Boolean(value.receipt) !== saved ||
      Boolean(value.memoryWrite) !== written ||
      (Boolean(value.candidate) &&
        (saved ||
          written ||
          !value.workflowId ||
          value.kind === "novel.planning-adopted")) ||
      (value.continuationTarget &&
        !["novel.chapter-adopted", "adaptation.script-adopted"].includes(
          value.kind,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Outcome path, status and authoritative evidence must agree.",
      });
    const duplicates = new Set<string>();
    for (const formal of value.formalVersions) {
      const key = `${formal.kind}:${formal.id}`;
      if (duplicates.has(key))
        ctx.addIssue({
          code: "custom",
          message: "A formal object must have exactly one frozen version.",
        });
      duplicates.add(key);
    }
    const adoptionKind = {
      "novel.chapter-adopted": "chapter",
      "novel.planning-adopted": "planning",
      "adaptation.diagnosis-adopted": "diagnosis",
      "adaptation.strategy-adopted": "adaptation-strategy",
      "adaptation.season-plan-adopted": "season-plan",
      "adaptation.script-adopted": "episode-script",
    } as const;
    const expected = adoptionKind[value.kind as keyof typeof adoptionKind];
    if (
      !saved &&
      !written &&
      (value.formalVersions.length !== 1 ||
        value.formalVersions[0]?.kind !== expected ||
        value.formalVersions[0]?.id !== value.objectId)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Adoption must identify exactly its own formal object version.",
      });
    if (written && value.memoryWrite) {
      const source = value.memoryWrite.source;
      const recordIds = new Set(
        value.memoryWrite.records.map((item) => item.id),
      );
      if (
        !value.workflowId ||
        value.workflowId !== value.objectId ||
        value.sourceVersions.length !== 1 ||
        value.sourceVersions[0]?.id !== source.id ||
        value.sourceVersions[0]?.version !== source.version ||
        recordIds.size !== value.memoryWrite.records.length ||
        value.formalVersions.length !== value.memoryWrite.records.length ||
        value.formalVersions.some(
          (item) =>
            item.kind !== "knowledge-record" ||
            item.version !== 0 ||
            !recordIds.has(item.id),
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "A memory write identifies one source chapter and the exact actual new Knowledge record set; it is not a human chapter adoption.",
        });
    }
    if (
      value.kind === "novel.manuscript-exported" &&
      value.formalVersions.some((item) => item.kind !== "chapter")
    )
      ctx.addIssue({
        code: "custom",
        message: "Manuscript result units are frozen chapter version sets.",
      });
    if (
      value.kind === "adaptation.pilot-package-exported" &&
      [
        "episode-outline",
        "episode-script",
        "storyboard",
        "script-document",
      ].some(
        (kind) =>
          value.formalVersions.filter((item) => item.kind === kind).length !==
          1,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Pilot results require the actual formal outline, script, storyboard and script document.",
      });
  });
export const CreativeOutcomeRecordSchema = CreativeOutcomeFactSchema.safeExtend(
  {
    eventId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    cursor: z.number().int().positive(),
    unitKey: z.string().regex(/^[a-f0-9]{64}$/u),
  },
);
export const CreativeOutcomePageSchema = z
  .object({
    projectId: z.string().uuid(),
    items: z.array(CreativeOutcomeRecordSchema),
    nextCursor: z.number().int().positive().optional(),
  })
  .strict();
export const CreativeQualityAssociationSchema =
  CreativeQualityAdoptionRecordSchema.safeExtend({
    links: z.array(
      z
        .object({
          relation: z.enum(["exact-target-version", "explicit-chapter-scope"]),
          outcomeKind: CreativeOutcomeKindSchema,
          objectId: z.string().uuid(),
          unitKey: z.string().regex(/^[a-f0-9]{64}$/u),
          formalVersion: CreativeOutcomeVersionSchema,
        })
        .strict(),
    ),
  }).superRefine((value, ctx) => {
    const targetKinds = {
      chapter: "chapter",
      diagnosis: "diagnosis",
      "season-plan": "season-plan",
      "episode-result": "episode-script",
    } as const;
    const duplicates = new Set<string>();
    const kinds = {
      chapter: ["novel.chapter-adopted", "novel.manuscript-exported"],
      diagnosis: ["adaptation.diagnosis-adopted"],
      "season-plan": ["adaptation.season-plan-adopted"],
      "episode-script": [
        "adaptation.script-adopted",
        "adaptation.pilot-package-exported",
      ],
    } as const;
    for (const link of value.links) {
      const formal = link.formalVersion;
      const key = JSON.stringify([
        link.unitKey,
        link.relation,
        formal.kind,
        formal.id,
        formal.version,
      ]);
      const exact = link.relation === "exact-target-version";
      const eligible = (
        kinds[formal.kind as keyof typeof kinds] as
          readonly string[] | undefined
      )?.includes(link.outcomeKind);
      const directAdoption = link.outcomeKind.endsWith("-adopted");
      if (
        duplicates.has(key) ||
        (directAdoption && link.objectId !== formal.id) ||
        !eligible ||
        (exact
          ? targetKinds[value.target.kind as keyof typeof targetKinds] !==
              formal.kind ||
            value.target.id !== formal.id ||
            value.target.version !== formal.version
          : formal.kind !== "chapter" ||
            !value.chapterScope?.included.some(
              (chapter) =>
                chapter.id === formal.id && chapter.version === formal.version,
            ))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Quality associations must identify exact historical owner versions or explicit scope members, never approximate titles or current quality.",
        });
      duplicates.add(key);
    }
  });
export const CreativeQualityAssociationSummarySchema = z
  .object({
    historyPolicy: z.literal("recorded-report-adoptions-only"),
    associationPolicy: z.literal("exact-owner-version-not-current-quality"),
    recordedReports: z.number().int().nonnegative(),
    reportsWithExactTarget: z.number().int().nonnegative(),
    reportsWithScopeMembers: z.number().int().nonnegative(),
    reportsWithoutRecordedOutcome: z.number().int().nonnegative(),
    linkedResultUnits: z.number().int().nonnegative(),
    items: z.array(CreativeQualityAssociationSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const observedExact = value.items.filter((item) =>
      item.links.some((link) => link.relation === "exact-target-version"),
    ).length;
    const observedScope = value.items.filter((item) =>
      item.links.some((link) => link.relation === "explicit-chapter-scope"),
    ).length;
    const observedUnassociated = value.items.filter(
      (item) => !item.links.length,
    ).length;
    const observedUnits = new Set(
      value.items.flatMap((item) => item.links.map((link) => link.unitKey)),
    ).size;
    const knownCounts = [
      [value.reportsWithExactTarget, observedExact],
      [value.reportsWithScopeMembers, observedScope],
      [value.reportsWithoutRecordedOutcome, observedUnassociated],
      [value.linkedResultUnits, observedUnits],
    ];
    if (
      knownCounts.some(([total, observed]) =>
        value.recordedReports <= 20 ? total !== observed : total! < observed!,
      ) ||
      value.recordedReports !==
        value.reportsWithExactTarget +
          value.reportsWithScopeMembers +
          value.reportsWithoutRecordedOutcome ||
      value.items.length !== Math.min(value.recordedReports, 20) ||
      new Set(value.items.map((item) => item.report.id)).size !==
        value.items.length ||
      (value.reportsWithExactTarget + value.reportsWithScopeMembers === 0) !==
        (value.linkedResultUnits === 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Report association counts are deduplicated historical observations, not a quality denominator.",
      });
  });
export const CreativeOutcomeSummarySchema = z
  .object({
    projectId: z.string().uuid(),
    asOf: z.string().datetime(),
    window: z
      .object({
        kind: z.literal("rolling-seven-days"),
        from: z.string().datetime(),
        to: z.string().datetime(),
      })
      .strict(),
    projection: z
      .object({
        state: z.enum(["healthy", "catching-up", "retrying", "degraded"]),
        checkpoint: z.number().int().nonnegative(),
      })
      .strict(),
    historyPolicy: z.literal("recorded-owner-facts-only"),
    funnel: CreativeFunnelSummarySchema,
    continuation: CreativeContinuationSummarySchema,
    qualityAssociations: CreativeQualityAssociationSummarySchema,
    goalConfirmations: CreativeInitialGoalSummarySchema,
    sourceConfirmations: CreativeSourceConfirmationSummarySchema,
    planningBatches: CreativePlanningAdoptionSummarySchema.optional(),
    planningFunnel: CreativePlanningFunnelSummarySchema.optional(),
    counts: z.array(
      z
        .object({
          kind: CreativeOutcomeKindSchema,
          total: z.number().int().nonnegative(),
          lastSevenDays: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    unavailable: z.array(
      z.enum([
        "first-candidate-adoption-rate",
        "seven-day-continuation-rate",
        "model-usage-and-cost",
        "narrative-quality-rate",
        "time-to-first-accepted-result",
      ]),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.planningBatches?.items.some(
        (item) => item.fact.projectId !== value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Planning batch history must preserve this exact project.",
      });
    if (
      value.planningFunnel?.measures.some(
        (measure) =>
          measure.sourceConflicts?.last &&
          measure.sourceConflicts.last.sourceConflict.projectId !==
            value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Planning source conflict history must preserve this exact project.",
      });
    if (
      value.sourceConfirmations.items.some(
        (item) => item.projectId !== value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Original source confirmation history must remain in this exact project.",
      });
    if (
      value.goalConfirmations.recordedProjects > 1 ||
      value.goalConfirmations.items.some(
        (item) => item.projectId !== value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Initial goal history must remain in this exact project.",
      });
    if (
      value.qualityAssociations.items.some(
        (item) => item.projectId !== value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Quality report history must remain in this exact project.",
      });
    if (
      value.funnel.measures.some(
        (measure) =>
          measure.lastSourceConflict &&
          measure.lastSourceConflict.sourceConflict.projectId !==
            value.projectId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Source conflict evidence must remain in this exact project summary.",
      });
    for (const item of value.continuation.observations) {
      if (!item.baseline || item.state === "clock-inconsistent") continue;
      const now = Date.parse(value.asOf);
      const deadline = Date.parse(item.baseline.deadline);
      if (
        Date.parse(item.baseline.adoptedAt) > now ||
        (item.firstStarted && Date.parse(item.firstStarted.startedAt) > now) ||
        (item.state === "pending") !== now < deadline
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Continuation state must use this summary's actual as-of clock.",
        });
    }
  });
export type CreativeOutcomeFact = z.infer<typeof CreativeOutcomeFactSchema>;
export type CreativeOutcomeRecord = z.infer<typeof CreativeOutcomeRecordSchema>;
export type CreativeOutcomePage = z.infer<typeof CreativeOutcomePageSchema>;
export type CreativeOutcomeSummary = z.infer<
  typeof CreativeOutcomeSummarySchema
>;
