import { z } from "zod";
import {
  ProjectInputSchema,
  StructuredScriptSceneSchema,
} from "./workspace.js";
import { ScreenplayBlockSchema } from "./screenplay-block.js";

const confirmation = z.object({
  rightsDeclared: z.literal(true),
  lossReportReviewed: z.literal(true),
});
export const ScreenplayIntakeCreateSchema = z.object({
  previewId: z.string().uuid(),
  grantId: z.string().uuid(),
});
export const ScreenplayIntakeCommitSchema = z
  .object({
    previewId: z.string().uuid(),
    project: ProjectInputSchema,
    confirmation,
  })
  .superRefine((value, ctx) => {
    if (
      value.project.mode !== "single_season" ||
      value.project.modeConfig?.mode !== "single_season" ||
      value.project.modeConfig.entryPath !== "script"
    )
      ctx.addIssue({
        code: "custom",
        path: ["project"],
        message: "剧本文件创建入口必须明确选择已有剧本的单季开发目标。",
      });
  });
export const ScreenplayIntakeReceiptSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().nonnegative(),
  adaptationId: z.string().uuid(),
  adaptationVersion: z.number().int().nonnegative(),
  episodeId: z.string().uuid(),
  episodeVersion: z.number().int().nonnegative(),
  scriptId: z.string().uuid(),
  scriptVersion: z.number().int().nonnegative(),
  documentId: z.string().uuid(),
  documentVersion: z.number().int().nonnegative(),
  committedAt: z.string().datetime(),
  episodes: z
    .array(
      z.object({
        previewEpisodeId: z.string().uuid(),
        episodeNumber: z.number().int().positive(),
        episodeId: z.string().uuid(),
        episodeVersion: z.number().int().nonnegative(),
        scriptId: z.string().uuid(),
        scriptVersion: z.number().int().nonnegative(),
        documentId: z.string().uuid(),
        documentVersion: z.number().int().nonnegative(),
        scenes: z.array(
          z.object({
            id: z.string().uuid(),
            version: z.number().int().nonnegative(),
            sourceIndex: z.number().int().nonnegative(),
          }),
        ),
      }),
    )
    .min(1)
    .optional(),
});
export const ScreenplayIntakeEpisodeSchema = z.object({
  id: z.string().uuid(),
  episodeNumber: z.number().int().positive(),
  title: z.string().min(1),
  content: z.string(),
  contentSource: z.enum(["episode-content", "scene-content"]),
  blocks: z.array(ScreenplayBlockSchema),
  scenes: z.array(StructuredScriptSceneSchema),
  lossReport: z.object({
    unsupported: z.array(z.string()),
    warnings: z.array(z.string()),
    preserved: z.array(z.string()),
  }),
});
export const ScreenplayIntakePreviewSchema = z
  .object({
    id: z.string().uuid(),
    sourceName: z.string(),
    sourceFormat: z.enum(["fountain", "fdx", "script-json"]),
    sourceTitle: z.string().optional(),
    episodes: z
      .array(ScreenplayIntakeEpisodeSchema)
      .min(1)
      .max(1000)
      .optional(),
    blocks: z.array(ScreenplayBlockSchema),
    lossReport: z.object({
      unsupported: z.array(z.string()),
      warnings: z.array(z.string()),
      preserved: z.array(z.string()),
    }),
    etag: z.string(),
    status: z.enum([
      "pending",
      "creating",
      "materialized",
      "committed",
      "discarded",
    ]),
    createdAt: z.string().datetime(),
    requestKey: z.string().optional(),
    request: ScreenplayIntakeCommitSchema.optional(),
    receipt: ScreenplayIntakeReceiptSchema.optional(),
    sourceState: z.enum(["current", "stale", "unknown"]),
  })
  .superRefine((preview, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (preview.sourceFormat !== "script-json") {
      if (preview.episodes || preview.receipt?.episodes)
        invalid("原生单稿不得附带结构化分集回执。");
      return;
    }
    const episodes = preview.episodes;
    if (!episodes || preview.blocks.length) {
      invalid("结构化剧本必须保留逐集来源，不得替换成合并或首集原稿。");
      return;
    }
    if (
      new Set(episodes.map((episode) => episode.id)).size !== episodes.length ||
      new Set(episodes.map((episode) => episode.episodeNumber)).size !==
        episodes.length
    )
      invalid("分集来源身份与分集号必须唯一。");
    if (!preview.receipt) return;
    const receipt = preview.receipt;
    const actual = receipt.episodes;
    if (!actual || actual.length !== episodes.length) {
      invalid("实际初始化回执必须包含全部来源分集。");
      return;
    }
    for (const [index, episode] of episodes.entries()) {
      const entry = actual[index]!;
      if (
        entry.previewEpisodeId !== episode.id ||
        entry.episodeNumber !== episode.episodeNumber ||
        entry.scenes.length !== episode.scenes.length ||
        entry.scenes.some(
          (scene, sceneIndex) => scene.sourceIndex !== sceneIndex,
        )
      )
        invalid("回执须按原文件顺序精确对应全部分集及场景。");
    }
    const identities = [
      receipt.projectId,
      receipt.adaptationId,
      ...actual.flatMap((entry) => [
        entry.episodeId,
        entry.scriptId,
        entry.documentId,
        ...entry.scenes.map((scene) => scene.id),
      ]),
    ];
    if (new Set(identities).size !== identities.length)
      invalid("实际分集、原稿、文档及场景不能复用对象身份。");
    const first = actual[0]!;
    if (
      receipt.episodeId !== first.episodeId ||
      receipt.episodeVersion !== first.episodeVersion ||
      receipt.scriptId !== first.scriptId ||
      receipt.scriptVersion !== first.scriptVersion ||
      receipt.documentId !== first.documentId ||
      receipt.documentVersion !== first.documentVersion
    )
      invalid("打开原稿须对应文件中的实际首个分集回执。");
  });
export type ScreenplayIntakePreview = z.infer<
  typeof ScreenplayIntakePreviewSchema
>;
export type ScreenplayIntakeCommit = z.infer<
  typeof ScreenplayIntakeCommitSchema
>;
