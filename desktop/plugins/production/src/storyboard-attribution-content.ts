import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  StoryDeclarationBasisSchema,
  StoryEventTimelineSchema,
} from "@dramaip/contracts/knowledge";
import {
  StoryboardAttributionCreateSchema,
  StoryboardAttributionLinkSchema,
  StoryboardAttributionSourceSchema,
  type StoryboardAttributionSource,
  type StoryboardAttributionCreate,
} from "@dramaip/contracts/production";
import { canonicalProductionRecordJSON } from "./record-baselines.js";

export const storyboardAttributionHash = (value: unknown) =>
  createHash("sha256")
    .update(canonicalProductionRecordJSON(value))
    .digest("hex");
export function storyboardAttributionSourceHash(
  source: Omit<
    StoryboardAttributionSource,
    "sourceFingerprint" | "baseAttributionId"
  >,
) {
  return storyboardAttributionHash(source);
}
const actualNode = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    kind: z.string(),
    title: z.string(),
    statement: z.string(),
    eventTimeline: StoryEventTimelineSchema.optional(),
    evidenceBasis: z.literal(
      "human-adopted-source-anchored-declaration-not-semantic-proof",
    ),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceAnchors: z
      .array(
        z
          .object({
            selection:
              StoryDeclarationBasisSchema.shape.sources.element.shape.selection,
            quoteHash:
              StoryDeclarationBasisSchema.shape.sources.element.shape.quoteHash,
            anchors:
              StoryDeclarationBasisSchema.shape.sources.element.shape.anchors,
          })
          .strict()
          .superRefine((source, check) => {
            if (
              source.anchors.some(
                (anchor) =>
                  (source.selection.kind === "screenplay-blocks") !==
                  "blockId" in anchor,
              )
            )
              check.addIssue({
                code: "custom",
                message: "实际章节与原稿块锚点不能互换。",
              });
          }),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((node, check) => {
    if (node.eventTimeline && node.kind !== "event")
      check.addIssue({
        code: "custom",
        message: "时间标注只能绑定原事件声明，不能替代实际原文位置。",
      });
  });

/** Exact identity/position checks only. No semantic inference, whole-scene
 * inheritance, first-match default or summary-to-original offset conversion. */
export function inspectStoryboardAttribution(input: {
  source: StoryboardAttributionSource;
  request: StoryboardAttributionCreate;
  nodeReference(
    nodeId: string,
    version: number,
  ): AgentContextReference | undefined;
}) {
  const source = StoryboardAttributionSourceSchema.parse(input.source);
  const request = StoryboardAttributionCreateSchema.parse(input.request);
  const {
    sourceFingerprint: fingerprint,
    baseAttributionId: base,
    ...body
  } = source;
  if (
    storyboardAttributionSourceHash(body) !== fingerprint ||
    request.sourceFingerprint !== fingerprint ||
    request.baseAttributionId !== base ||
    request.storyboard.id !== source.storyboard.id ||
    request.storyboard.version !== source.storyboard.version
  )
    throw new Error("原来源指纹、正式分镜或关联采用位置不一致。");
  const blockIndex = new Map(source.scriptBlocks.map((b) => [b.id, b.index]));
  if (
    blockIndex.size !== source.scriptBlocks.length ||
    source.scriptBlocks.some((b, index) => b.index !== index) ||
    new Set(source.shots.map((s) => s.shotId)).size !== source.shots.length ||
    new Set(source.evidence.map((e) => e.evidenceId)).size !==
      source.evidence.length
  )
    throw new Error("实际镜头、稳定块或引文标识不唯一／顺序不完整。");
  const links = request.selections.map((selection) => {
    const shot = source.shots.find(
      (s) => s.shotId === selection.shotId && s.sceneId === selection.sceneId,
    );
    const evidence = source.evidence.find(
      (e) =>
        e.evidenceId === selection.evidenceId &&
        e.sceneId === selection.sceneId,
    );
    const match = evidence?.matches[selection.matchIndex];
    if (
      !shot ||
      !evidence ||
      !match ||
      match.end - match.start !== evidence.quoteCharacters ||
      Boolean(match.chapterStart !== undefined) !==
        Boolean(match.chapterEnd !== undefined) ||
      (match.chapterStart !== undefined &&
        match.chapterEnd! - match.chapterStart !== evidence.quoteCharacters)
    )
      throw new Error(
        "必须明确实际镜头、本场引文和具体匹配位置，不默认第一处。",
      );
    if (
      selection.blockIds.some(
        (id, index) =>
          !shot.sourceBlockIds.includes(id) ||
          !blockIndex.has(id) ||
          (index > 0 &&
            blockIndex.get(selection.blockIds[index - 1]!)! >=
              blockIndex.get(id)!),
      )
    )
      throw new Error(
        "关联剧本块必须来自此镜头实际稳定块并保持原顺序，不猜测其他场景。",
      );
    let storyNode;
    if (selection.storyNode) {
      const reference = input.nodeReference(
        selection.storyNode.id,
        selection.storyNode.version,
      );
      if (!reference || reference.sourceKind !== "knowledge")
        throw new Error("实际已采用故事节点不可用或已失效。");
      const node = actualNode.parse(reference.value);
      if (
        node.projectId !== source.projectId ||
        reference.sourceId !== node.id ||
        reference.sourceVersion !== node.version ||
        reference.fieldPath !== `/story-declarations/${node.id}` ||
        !reference.policyDependencies?.some(
          (d) =>
            d.sourceId === selection.storyNode!.id &&
            d.sourceVersion === selection.storyNode!.version &&
            d.fieldPath ===
              `/story-declarations/nodes/${selection.storyNode!.id}`,
        )
      )
        throw new Error("故事节点声明归属与实际采用节点版本无法核对。");
      const chapter =
        evidence.source.sourceKind === "chapter"
          ? source.chapters.find(
              (c) =>
                c.id === evidence.source.sourceId &&
                c.version === evidence.source.sourceVersion,
            )
          : undefined;
      const paragraphLink = node.sourceAnchors.some(
        ({ selection: nodeSource, anchors }) =>
          nodeSource.kind !== "screenplay-blocks" &&
          chapter &&
          nodeSource.chapterId === chapter.id &&
          nodeSource.chapterVersion === chapter.version &&
          nodeSource.chapterContentHash === chapter.contentHash &&
          match.chapterStart !== undefined &&
          match.chapterEnd !== undefined &&
          anchors.some(
            (anchor) =>
              "start" in anchor &&
              anchor.start <= match.chapterStart! &&
              anchor.end >= match.chapterEnd! &&
              (!evidence.paragraphId ||
                anchor.paragraphIds.includes(evidence.paragraphId)),
          ),
      );
      const original = source.originalScriptDocument;
      const screenplayLink = node.sourceAnchors.some(
        ({ selection: nodeSource, anchors }) =>
          nodeSource.kind === "screenplay-blocks" &&
          original &&
          evidence.source.sourceKind === "production" &&
          evidence.source.sourceId === original.scriptId &&
          evidence.source.sourceVersion === original.scriptVersion &&
          evidence.sourceBlockId &&
          nodeSource.scriptId === original.scriptId &&
          nodeSource.scriptVersion === original.scriptVersion &&
          nodeSource.documentId === original.id &&
          nodeSource.documentVersion === original.version &&
          nodeSource.documentContentHash === original.contentHash &&
          nodeSource.blockIds.includes(evidence.sourceBlockId) &&
          anchors.some(
            (anchor) =>
              "blockId" in anchor && anchor.blockId === evidence.sourceBlockId,
          ),
      );
      const factLink = node.sourceAnchors.some(
        ({ selection: nodeSource }) =>
          nodeSource.kind === "adopted-fact" &&
          evidence.source.sourceKind === "knowledge" &&
          nodeSource.recordId === evidence.source.sourceId &&
          nodeSource.recordVersion === evidence.source.sourceVersion,
      );
      const linkKind = paragraphLink
        ? "chapter-position"
        : screenplayLink
          ? "screenplay-block"
          : factLink
            ? "adopted-fact-record-not-original-quote-position"
            : undefined;
      if (!linkKind)
        throw new Error(
          "节点必须锚定同一具体原章位置、原稿块或实际采用事实，不把同项目或摘要位置当原文证明。",
        );
      storyNode = {
        node: selection.storyNode,
        declaration: { id: node.id, version: node.version },
        referenceHash: storyboardAttributionHash(reference),
        linkKind,
        semanticVerification: "unverified" as const,
      };
    }
    const { matches: _matches, ...identity } = evidence;
    return StoryboardAttributionLinkSchema.parse({
      sceneId: selection.sceneId,
      shotId: selection.shotId,
      blockIds: selection.blockIds,
      evidenceId: selection.evidenceId,
      matchIndex: selection.matchIndex,
      evidence: { ...identity, match },
      ...(storyNode ? { storyNode } : {}),
      attribution: "human-declared",
      matchVerification: "rule",
      semanticVerification: "unverified",
    });
  });
  const associated = new Set(links.map((l) => l.shotId));
  const coverage = {
    totalShots: source.shots.length,
    associatedShots: associated.size,
    nodeAssociatedShots: new Set(
      links.filter((l) => l.storyNode).map((l) => l.shotId),
    ).size,
    associatedBlockCount: new Set(links.flatMap((l) => l.blockIds)).size,
    unassociatedShotIds: source.shots
      .filter((s) => !associated.has(s.shotId))
      .map((s) => s.shotId),
  };
  return {
    links,
    coverage,
    associationFingerprint: storyboardAttributionHash({
      sourceFingerprint: fingerprint,
      selections: request.selections,
      links,
      coverage,
    }),
  };
}
