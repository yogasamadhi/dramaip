import { z } from "zod";
import { StoryboardSourceReviewReceiptSchema } from "./storyboard-source-review.js";

const text = z.string().trim().min(1).max(4000);
const stableId = z.string().trim().min(1).max(64);
const blockIds = z.array(z.string().uuid()).min(1).max(10000);

/** Structured production proposal, not generated media or a price quotation. */
export const StoryboardPackageContentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  visualDirection: text,
  productionNotes: z.array(text).min(1).max(100),
  assets: z
    .array(
      z.object({
        id: stableId,
        kind: z.enum(["character", "location", "prop", "voice", "visual"]),
        title: text,
        description: text,
        sourceBibleIds: z.array(z.string().uuid()).min(1).max(100),
      }),
    )
    .min(1)
    .max(500),
  scenes: z
    .array(
      z.object({
        sceneId: stableId,
        scriptBlockIds: blockIds,
        shots: z
          .array(
            z.object({
              id: stableId,
              orderIndex: z.number().int().nonnegative(),
              sourceBlockIds: blockIds,
              visualAction: text,
              composition: text,
              camera: text,
              movement: text,
              durationSeconds: z.number().int().min(1).max(1800),
              sound: text,
              prompt: text,
              negativePrompt: text,
              assetIds: z.array(stableId).min(1).max(100),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .min(1)
    .max(120),
  subtitles: z
    .array(
      z.object({
        id: stableId,
        shotId: stableId,
        startSeconds: z.number().nonnegative(),
        endSeconds: z.number().positive(),
        text,
        sourceBlockIds: blockIds,
      }),
    )
    .max(10000),
  costRisks: z
    .array(
      z.object({
        severity: z.enum(["low", "medium", "high"]),
        reason: text,
        shotIds: z.array(stableId).min(1).max(1000),
        mitigation: text,
      }),
    )
    .max(500),
  externalDependencies: z.array(text).max(100),
});
export type StoryboardPackageContent = z.infer<
  typeof StoryboardPackageContentSchema
>;

/** A real scoped generation output, never a whole-package replacement. Global
 * direction/assets/dependencies and unselected shots are not model-editable. */
export const StoryboardShotPatchSchema = z
  .object({
    format: z.literal("selected-storyboard-shots-v1"),
    shots: z
      .array(
        StoryboardPackageContentSchema.shape.scenes.element.shape.shots.element.strict(),
      )
      .min(1)
      .max(1000),
    subtitles: z
      .array(StoryboardPackageContentSchema.shape.subtitles.element.strict())
      .max(10000),
    costRisks: z
      .array(StoryboardPackageContentSchema.shape.costRisks.element.strict())
      .max(500),
  })
  .strict();
/** Explicit opt-in for author-confirmed within-scene block topology only. */
export const StoryboardBlockStructurePatchSchema =
  StoryboardShotPatchSchema.extend({
    format: z.literal("selected-storyboard-block-structure-v1"),
  });
/** The author freezes identities/order/durations/assets before generation.
 * The model still supplies only the selected expressions and captions. */
export const StoryboardSceneShotPlanPatchSchema =
  StoryboardShotPatchSchema.extend({
    format: z.literal("selected-scene-shot-plan-v1"),
  });
const actualRef = z
  .object({
    recordId: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const StoryboardSceneShotPlanSchema = actualRef
  .extend({
    sceneId: z.string().min(1).max(64),
    shots: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            orderIndex: z.number().int().nonnegative(),
            durationSeconds: z.number().int().min(1).max(1800),
            assetIds: z.array(z.string().min(1).max(64)).min(1).max(100),
            retains: actualRef.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const StoryboardShotPlanRequestSchema = z
  .object({
    format: z.literal("author-scene-shot-plan-v1"),
    scenePlans: z.array(StoryboardSceneShotPlanSchema).min(1).max(120),
  })
  .strict()
  .superRefine((value, ctx) => {
    const shots = value.scenePlans.flatMap((scene) => scene.shots);
    const retained = shots.flatMap((shot) =>
      shot.retains ? [shot.retains.recordId] : [],
    );
    if (
      shots.length > 1000 ||
      new Set(shots.map((shot) => shot.id)).size !== shots.length ||
      new Set(retained).size !== retained.length ||
      new Set(value.scenePlans.map((scene) => scene.sceneId)).size !==
        value.scenePlans.length ||
      new Set(value.scenePlans.map((scene) => scene.recordId)).size !==
        value.scenePlans.length ||
      value.scenePlans.some((scene) =>
        scene.shots.some(
          (shot, index) =>
            shot.orderIndex !== index ||
            new Set(shot.assetIds).size !== shot.assetIds.length ||
            (!shot.retains && !z.string().uuid().safeParse(shot.id).success),
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "场景镜头计划须完整连续排序、身份唯一；新增镜头须使用新 UUID，不猜复用身份。",
      });
  });
export type StoryboardShotPlanRequest = z.infer<
  typeof StoryboardShotPlanRequestSchema
>;
/** Standalone topology plan. Runtime admission is separately opt-in; adding
 * this shape does not relax any of the three existing redo protocols. */
export const StoryboardTopologyPlanRequestSchema = z
  .object({
    format: z.literal("author-scene-topology-plan-v1"),
    scenes: z
      .array(
        z
          .object({
            sceneId: stableId,
            orderIndex: z.number().int().nonnegative(),
            durationSeconds: z.number().int().min(1).max(1800),
            mode: z.enum(["retain", "generate"]),
            retains: actualRef.optional(),
            shots: StoryboardSceneShotPlanSchema.shape.shots,
          })
          .strict(),
      )
      .min(1)
      .max(120),
    retiredScenes: z
      .array(actualRef.extend({ sceneId: stableId }).strict())
      .max(120),
    retiredShots: z
      .array(actualRef.extend({ shotId: stableId }).strict())
      .max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const shots = value.scenes.flatMap((scene) => scene.shots);
    const retained = [
      ...value.scenes.flatMap((scene) =>
        scene.retains ? [scene.retains.recordId] : [],
      ),
      ...shots.flatMap((shot) => (shot.retains ? [shot.retains.recordId] : [])),
    ];
    if (
      shots.length > 1000 ||
      new Set(value.scenes.map((scene) => scene.sceneId)).size !==
        value.scenes.length ||
      new Set(shots.map((shot) => shot.id)).size !== shots.length ||
      new Set(retained).size !== retained.length ||
      value.scenes.some(
        (scene, index) =>
          scene.orderIndex !== index ||
          (scene.mode === "retain" && !scene.retains) ||
          (!scene.retains &&
            !z.string().uuid().safeParse(scene.sceneId).success) ||
          scene.shots.some(
            (shot, i) =>
              shot.orderIndex !== i ||
              new Set(shot.assetIds).size !== shot.assetIds.length ||
              (!shot.retains && !z.string().uuid().safeParse(shot.id).success),
          ),
      ) ||
      new Set(value.retiredScenes.map((scene) => scene.sceneId)).size !==
        value.retiredScenes.length ||
      new Set(value.retiredShots.map((shot) => shot.shotId)).size !==
        value.retiredShots.length ||
      new Set([
        ...retained,
        ...value.retiredScenes.map((scene) => scene.recordId),
        ...value.retiredShots.map((shot) => shot.recordId),
      ]).size !==
        retained.length + value.retiredScenes.length + value.retiredShots.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "场景拓扑计划须完整连续、独立新 UUID、实际复用和明确退役身份，不重复或复活旧记录。",
      });
  });
export const StoryboardSceneTopologyPlanPatchSchema =
  StoryboardShotPatchSchema.extend({
    format: z.literal("selected-scene-topology-plan-v1"),
  });
export const StoryboardRedoPatchSchema = z.discriminatedUnion("format", [
  StoryboardShotPatchSchema,
  StoryboardBlockStructurePatchSchema,
  StoryboardSceneShotPlanPatchSchema,
  StoryboardSceneTopologyPlanPatchSchema,
]);
export type StoryboardTopologyPlanRequest = z.infer<
  typeof StoryboardTopologyPlanRequestSchema
>;
export const StoryboardRedoSelectionSchema = z
  .array(
    z
      .object({
        shotId: stableId,
        recordId: z.string().uuid(),
        version: z.number().int().nonnegative(),
      })
      .strict(),
  )
  .min(1)
  .max(1000);
const FixedStoryboardRedoReceiptSchema = z
  .object({
    base: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict(),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    shots: StoryboardRedoSelectionSchema,
    previousScript: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict(),
    scope: z.literal("stable-mapping-fixed-duration-existing-assets-v1"),
    semanticVerification: z.literal("unverified"),
    sourceReview: StoryboardSourceReviewReceiptSchema.optional(),
  })
  .strict();
export const StoryboardBlockStructureMappingSchema = z
  .object({
    sceneId: stableId,
    previousBlockIds: blockIds,
    currentBlockIds: blockIds,
  })
  .strict();
export const StoryboardBlockStructureReceiptSchema =
  FixedStoryboardRedoReceiptSchema.extend({
    scope: z.literal(
      "confirmed-block-structure-fixed-shots-duration-assets-v1",
    ),
    sceneMappings: z
      .array(StoryboardBlockStructureMappingSchema)
      .min(1)
      .max(120),
  });
export const StoryboardShotPlanReceiptSchema =
  FixedStoryboardRedoReceiptSchema.extend({
    scope: z.literal("author-frozen-scene-shot-plan-v1"),
    sceneMappings: z.array(StoryboardBlockStructureMappingSchema).max(120),
    scenePlans: StoryboardShotPlanRequestSchema.shape.scenePlans,
  }).superRefine((value, ctx) => {
    const plan = StoryboardShotPlanRequestSchema.safeParse({
      format: "author-scene-shot-plan-v1",
      scenePlans: value.scenePlans,
    });
    if (
      !plan.success ||
      new Set(value.shots.map((shot) => shot.recordId)).size !==
        value.shots.length ||
      new Set(value.shots.map((shot) => shot.shotId)).size !==
        value.shots.length ||
      value.scenePlans.some((scene) =>
        scene.shots.some(
          (shot) =>
            shot.retains &&
            !value.shots.some(
              (old) =>
                old.shotId === shot.id &&
                old.recordId === shot.retains!.recordId &&
                old.version === shot.retains!.version,
            ),
        ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "冻结镜头计划与原实际复用身份／版本不一致。",
      });
  });
const formalRef = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
export const StoryboardTopologyPlanReceiptSchema =
  FixedStoryboardRedoReceiptSchema.extend({
    scope: z.literal("author-frozen-scene-topology-plan-v1"),
    previousOutline: formalRef,
    script: formalRef,
    outline: formalRef,
    topologyPlan: StoryboardTopologyPlanRequestSchema,
    selectedScenes: z
      .array(actualRef.extend({ sceneId: stableId }).strict())
      .min(1)
      .max(120),
    ancestry: z
      .array(
        z
          .object({
            sourceKind: z.literal("production"),
            sourceId: z.string().uuid(),
            sourceVersion: z.number().int().positive(),
            fieldPath: z.string().startsWith("/production/"),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(4)
      .max(2000),
    topologySteps: z.number().int().min(1).max(999),
  }).superRefine((value, ctx) => {
    if (
      new Set(value.selectedScenes.map((scene) => scene.recordId)).size !==
        value.selectedScenes.length ||
      new Set(value.selectedScenes.map((scene) => scene.sceneId)).size !==
        value.selectedScenes.length ||
      new Set(value.shots.map((shot) => shot.recordId)).size !==
        value.shots.length ||
      new Set(value.shots.map((shot) => shot.shotId)).size !==
        value.shots.length ||
      new Set(value.ancestry.map((ref) => ref.sourceId)).size !==
        value.ancestry.length ||
      [
        value.previousScript,
        value.previousOutline,
        value.script,
        value.outline,
      ].some(
        (ref) =>
          !value.ancestry.some(
            (ancestor) =>
              ancestor.sourceId === ref.id &&
              ancestor.sourceVersion === ref.version,
          ),
      ) ||
      value.topologyPlan.scenes.some(
        (scene) =>
          scene.mode === "generate" &&
          scene.retains &&
          !value.selectedScenes.some(
            (old) =>
              old.sceneId === scene.sceneId &&
              old.recordId === scene.retains!.recordId &&
              old.version === scene.retains!.version,
          ),
      ) ||
      value.topologyPlan.retiredScenes.some(
        (scene) =>
          !value.selectedScenes.some(
            (old) => JSON.stringify(old) === JSON.stringify(scene),
          ),
      ) ||
      value.topologyPlan.retiredShots.some(
        (shot) =>
          !value.shots.some(
            (old) =>
              old.shotId === shot.shotId &&
              old.recordId === shot.recordId &&
              old.version === shot.version,
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "拓扑冻结回执必须绑定完整旧选择、明确退役与实际双正式祖先。",
      });
  });
export const StoryboardRedoReceiptSchema = z.discriminatedUnion("scope", [
  FixedStoryboardRedoReceiptSchema,
  StoryboardBlockStructureReceiptSchema,
  StoryboardShotPlanReceiptSchema,
  StoryboardTopologyPlanReceiptSchema,
]);
export type StoryboardBlockStructureMapping = z.infer<
  typeof StoryboardBlockStructureMappingSchema
>;
export type StoryboardShotPatch = z.infer<typeof StoryboardShotPatchSchema>;
export type StoryboardRedoReceipt = z.infer<typeof StoryboardRedoReceiptSchema>;
