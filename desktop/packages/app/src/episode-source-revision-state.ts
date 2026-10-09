import { z } from "zod";
import {
  EpisodeSourceRevisionInputSchema,
  EpisodeSourceRevisionConfirmationSchema,
  EpisodeDevelopmentRequestSchema,
  type EpisodeDevelopmentCatalog,
  type EpisodeDevelopmentRequest,
  type EpisodeDevelopmentResult,
  type EpisodeScriptContent,
  type EpisodeOutlineContent,
  type EpisodeSourceRevision,
  type ScreenplayDocument,
} from "@dramaip/contracts/production";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";
import type { OwnerRead } from "./current-owner-read";
import {
  sameFrozenOwnerSnapshot,
  successfulOwnerRead,
} from "./current-owner-read";

const ref = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();
const binding = z.object({
  format: z.literal("author-source-revision-request-v1"),
  projectId: z.string().uuid(),
  episodeId: z.string().min(1).max(64),
  sourceScript: ref,
  sourceOutline: ref,
  document: z
    .object({
      id: z.string().uuid(),
      scriptId: z.string().uuid(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
  key: z.string().uuid(),
  savedAt: z.string().datetime(),
});
export const SourceRevisionRecoverySchema = z
  .discriminatedUnion("action", [
    binding
      .extend({
        action: z.literal("preview"),
        input: EpisodeSourceRevisionInputSchema,
      })
      .strict(),
    binding
      .extend({
        action: z.literal("adopt"),
        id: z.string().uuid(),
        stateVersion: z.number().int().nonnegative(),
        confirmation: EpisodeSourceRevisionConfirmationSchema,
      })
      .strict(),
    binding
      .extend({
        action: z.literal("discard"),
        id: z.string().uuid(),
        stateVersion: z.number().int().nonnegative(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (
      value.sourceScript.id === value.sourceOutline.id ||
      (value.action === "preview" &&
        (value.input.sourceVersion !== value.sourceScript.version ||
          !sameFrozenOwnerSnapshot(value.input.outline, value.sourceOutline) ||
          value.input.documentVersion !== value.document.version ||
          value.input.request.episodeId !== value.episodeId ||
          (value.input.request.direct &&
            value.input.request.direct.project.id !== value.projectId)))
    )
      ctx.addIssue({
        code: "custom",
        message: "恢复记录与完整原请求身份不符，不猜最新来源。",
      });
  });
export type SourceRevisionRecovery = z.infer<
  typeof SourceRevisionRecoverySchema
>;
export type SourceRevisionBinding = Pick<
  SourceRevisionRecovery,
  "projectId" | "episodeId" | "sourceScript" | "sourceOutline"
>;
export type RecoveryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export const sourceRevisionRecoveryKey = (value: SourceRevisionBinding) =>
  `dramaip-source-revision-request:${value.projectId}:${value.sourceScript.id}:${value.sourceScript.version}`;

export function readSourceRevisionRecovery(
  storage: RecoveryStorage,
  expected: SourceRevisionBinding,
): SourceRevisionRecovery | undefined {
  const raw = storage.getItem(sourceRevisionRecoveryKey(expected));
  if (raw === null) return undefined;
  const value = SourceRevisionRecoverySchema.parse(JSON.parse(raw));
  if (!matchesSourceRevisionBinding(value, expected))
    throw new Error(
      "本机恢复记录属于其他项目／原正式双头；记录保留，未发送请求。",
    );
  return value;
}
export function matchesSourceRevisionBinding(
  value: SourceRevisionBinding,
  expected: SourceRevisionBinding,
): boolean {
  return (
    value.projectId === expected.projectId &&
    value.episodeId === expected.episodeId &&
    sameFrozenOwnerSnapshot(value.sourceScript, expected.sourceScript) &&
    sameFrozenOwnerSnapshot(value.sourceOutline, expected.sourceOutline)
  );
}
// This is UI recovery, not authoritative business state or a cross-window lock.
// Known changes must never be overwritten, including by a late successful reply.
export function saveSourceRevisionRecovery(
  storage: RecoveryStorage,
  raw: SourceRevisionRecovery,
) {
  const value = SourceRevisionRecoverySchema.parse(raw);
  if (storage.getItem(sourceRevisionRecoveryKey(value)) !== null)
    throw new Error(
      "原请求或另一窗口的恢复记录尚未处理；未覆盖，也未发送新请求。",
    );
  const encoded = JSON.stringify(value);
  storage.setItem(sourceRevisionRecoveryKey(value), encoded);
  if (storage.getItem(sourceRevisionRecoveryKey(value)) !== encoded)
    throw new Error("原请求未可靠保存，未发送请求。");
  return value;
}
export function clearSourceRevisionRecovery(
  storage: RecoveryStorage,
  value: SourceRevisionRecovery,
) {
  const actual = readSourceRevisionRecovery(storage, value);
  if (!sameFrozenOwnerSnapshot(actual, value))
    throw new Error("本机原请求已变化；未删除另一笔恢复记录。");
  storage.removeItem(sourceRevisionRecoveryKey(value));
  if (storage.getItem(sourceRevisionRecoveryKey(value)) !== null)
    throw new Error("本机原请求尚未清除；仍保留恢复状态。");
}
export function readExactSourceRevision<
  T extends SourceRevisionBinding & { id: string },
>(query: OwnerRead<T>, expected: SourceRevisionBinding & { id: string }) {
  const value = successfulOwnerRead(query);
  return value?.id === expected.id &&
    matchesSourceRevisionBinding(value, expected)
    ? value
    : undefined;
}
export function verifySourceRevisionRecoveryReply(
  value: Pick<
    EpisodeSourceRevision,
    | "id"
    | "projectId"
    | "episodeId"
    | "sourceScript"
    | "sourceOutline"
    | "document"
    | "input"
    | "stateVersion"
    | "status"
    | "confirmation"
  >,
  original: SourceRevisionRecovery,
) {
  if (
    !matchesSourceRevisionBinding(value, original) ||
    !sameFrozenOwnerSnapshot(value.document, original.document) ||
    (original.action === "preview" &&
      !sameFrozenOwnerSnapshot(value.input, original.input)) ||
    (original.action !== "preview" &&
      (value.id !== original.id ||
        value.stateVersion !== original.stateVersion + 1 ||
        value.status !==
          (original.action === "adopt" ? "adopted" : "discarded") ||
        (original.action === "adopt" &&
          !sameFrozenOwnerSnapshot(value.confirmation, original.confirmation))))
  )
    throw new Error(
      "回复未对应完整原请求／决定；原恢复记录保留，不返回另一份候选。",
    );
}

export function sourceRevisionSceneLinks(
  document: ScreenplayDocument,
  script: EpisodeScriptContent,
): EpisodeScriptContent["sceneLinks"] {
  const links: EpisodeScriptContent["sceneLinks"] = [];
  for (const block of document.blocks) {
    if (block.type === "scene_heading")
      links.push({
        sceneId:
          script.sceneLinks.find((link) => link.blockIds[0] === block.id)
            ?.sceneId ?? "",
        blockIds: [block.id],
      });
    else {
      const group = links.at(-1);
      if (!group)
        throw new Error(
          "实际文档含场景标题前的块；请先在原稿编辑入口明确处理，不自动丢弃。",
        );
      group.blockIds.push(block.id);
    }
  }
  if (!links.length)
    throw new Error("实际保存文档没有场景标题，不推测场景映射。");
  return links;
}
export function newSourceRevisionRequest(
  original: EpisodeDevelopmentResult,
  catalog: EpisodeDevelopmentCatalog,
  choice: {
    sourceScriptId?: string;
    durationSeconds: number;
    novelMode: "inherit" | "independent";
    narrative: NarrativeContextRequest;
  },
): EpisodeDevelopmentRequest {
  const outline = original.basis.request.outline;
  if (
    !outline ||
    original.operation !== "episode-script" ||
    catalog.projectId !== original.projectId
  )
    throw new Error("原正式剧本／大纲或当前来源目录归属不完整。");
  const evidence = original.basis.request.sourceEvidenceFormat
    ? { sourceEvidenceFormat: original.basis.request.sourceEvidenceFormat }
    : {};
  const previous = original.basis.request.direct;
  if (previous) {
    const direct = catalog.direct,
      episode = direct?.episodes.find((item) => item.id === original.episodeId);
    const source = episode?.scripts.find(
      (item) => item.id === choice.sourceScriptId,
    );
    if (
      !direct ||
      !episode ||
      !direct.authorIntent ||
      direct.entryPath !== previous.entryPath ||
      (choice.sourceScriptId && !source) ||
      (direct.entryPath === "script" && !source)
    )
      throw new Error(
        "须明确当前同入口、实际原分集与剧本来源，不自动选择列表首项。",
      );
    return EpisodeDevelopmentRequestSchema.parse({
      ...evidence,
      episodeId: original.episodeId,
      baseOutlineId: outline.id,
      direct: {
        entryPath: direct.entryPath,
        project: direct.project,
        authorIntent: direct.authorIntent,
        episode: { id: episode.id, version: episode.version },
        durationSeconds: choice.durationSeconds,
        ...(source
          ? {
              sourceScript: {
                id: source.id,
                version: source.version,
                documentVersion: source.documentVersion,
              },
            }
          : {}),
      },
    });
  }
  if (
    !catalog.seasonPlan ||
    !catalog.episodes.some((item) => item.id === original.episodeId)
  )
    throw new Error("当前季纲没有原分集，不切到第一集或另一条入口。");
  return EpisodeDevelopmentRequestSchema.parse({
    ...evidence,
    episodeId: original.episodeId,
    baseOutlineId: outline.id,
    seasonPlan: catalog.seasonPlan,
    ...(choice.novelMode === "independent"
      ? { episodeNarrativeContext: structuredClone(choice.narrative) }
      : catalog.narrativeSources
        ? { inheritSeasonNarrative: true as const }
        : {}),
  });
}

// Explicit author action only: rebind versions for the very same selected ID.
// No new identities, reference paths, quote locations or quote text are guessed.
export function rebindSameSelectedSourceVersions(
  outline: EpisodeOutlineContent,
  input: EpisodeDevelopmentRequest,
  catalog: EpisodeDevelopmentCatalog,
) {
  const versions = new Map<string, number>();
  const put = (kind: string, id: string, version: number) =>
    versions.set(`${kind}:${id}`, version);
  const direct = input.direct;
  if (direct) {
    put("project", direct.project.id, direct.project.version);
    put("author_intent", direct.authorIntent.id, direct.authorIntent.version);
    put("production", direct.episode.id, direct.episode.version);
    if (direct.sourceScript)
      put("production", direct.sourceScript.id, direct.sourceScript.version);
  } else {
    if (input.seasonPlan)
      put("production", input.seasonPlan.id, input.seasonPlan.version);
    const chapters =
      input.episodeNarrativeContext?.chapters ??
      (input.inheritSeasonNarrative
        ? catalog.narrativeSources?.basis.chapters
        : catalog.episodes.find((item) => item.id === input.episodeId)
            ?.sourceChapters);
    for (const chapter of chapters ?? []) {
      put("chapter", chapter.id, chapter.version);
      if ("representation" in chapter && chapter.representation === "summary")
        put("knowledge", chapter.record.id, chapter.record.version);
    }
    const summaries = input.episodeNarrativeContext?.summaries;
    for (const summary of summaries ?? [])
      put("knowledge", summary.id, summary.version);
    if (input.inheritSeasonNarrative)
      for (const summary of catalog.narrativeSources?.basis.summaries ?? []) {
        put("knowledge", summary.id, summary.version);
        for (const chapter of summary.chapters)
          put("chapter", chapter.id, chapter.version);
      }
  }
  const next = structuredClone(outline);
  for (const scene of next.scenes) {
    for (const chapter of scene.sourceChapters) {
      const version = versions.get(`chapter:${chapter.id}`);
      if (version !== undefined) chapter.version = version;
    }
    for (const source of [
      ...(scene.sourceReferences ?? []),
      ...(scene.sourceEvidence ?? []).map((item) => item.source),
    ]) {
      const version = versions.get(`${source.sourceKind}:${source.sourceId}`);
      if (version !== undefined) source.sourceVersion = version;
    }
  }
  return next;
}
