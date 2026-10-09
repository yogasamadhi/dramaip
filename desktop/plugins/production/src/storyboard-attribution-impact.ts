import {
  AGENT_CONTEXT_SERVICE,
  type AgentContextEntry,
} from "@dramaip/contracts/agent-context";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
  KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE,
  StoryNodeObservationSchema,
} from "@dramaip/contracts/knowledge";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
  StoryboardAttributionSchema,
  StoryboardAttributionImpactSchema,
  StoryboardAttributionImpactSelectionSchema,
  type StoryboardAttribution,
  type StoryboardAttributionImpact,
  type StoryboardAttributionImpactLink,
  type StoryboardAttributionImpactSelection,
  type EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import {
  optionalService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  captureProductionRecordBaseline,
  type BaselineRecordRow,
} from "./record-baselines.js";
import {
  storyboardAttributionHash,
  storyboardAttributionSourceHash,
} from "./storyboard-attribution-content.js";
import { directScriptSourceContent } from "./direct-script-source.js";
import {
  attributionExpressionKey,
  attributionImpactState,
  compareAttributionQuote,
  type AttributionExpressionRead,
} from "./storyboard-attribution-impact-content.js";

type Original = Omit<
  StoryboardAttribution,
  "isCurrent" | "sourceState" | "sourceReasons"
>;
type Result = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
export class AttributionImpactError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const unavailable = (): AttributionExpressionRead => ({
  readState: "unavailable",
  version: null,
});

/** This is a readonly observation, not the strict creation/adoption capture.
 * Peer owners run outside our UOW; no writes, asynchronous yield, rematching,
 * latest-head selection, replacement node binding or semantic safety claim. */
export function createStoryboardAttributionImpactReader(
  context: PluginContext,
  owner: {
    read(
      tx: UnitOfWorkTransaction,
      projectId: string,
      id: string,
    ): Original | undefined;
    head(
      tx: UnitOfWorkTransaction,
      projectId: string,
      storyboardId: string,
    ): string | null;
    readResult(tx: UnitOfWorkTransaction, id: string): Result | undefined;
  },
) {
  return (
    projectId: string,
    storyboard: { id: string; version: number; episodeId: string },
    selection: StoryboardAttributionImpactSelection,
  ): StoryboardAttributionImpact => {
    const selected =
      StoryboardAttributionImpactSelectionSchema.parse(selection);
    const captured = context.uow.execute((tx) => {
      const original = owner.read(tx, projectId, selected.id);
      if (!original)
        throw new AttributionImpactError(
          404,
          "指定原关联不存在或不属于本项目。",
        );
      if (
        original.version !== selected.version ||
        original.status !== "adopted" ||
        original.source.projectId !== projectId ||
        original.source.episodeId !== storyboard.episodeId ||
        original.source.storyboard.id !== storyboard.id ||
        original.source.storyboard.version !== storyboard.version
      )
        throw new AttributionImpactError(
          409,
          "指定原采用关联的版本、项目、分集或分镜绑定不符，不补最新关联。",
        );
      const value = StoryboardAttributionSchema.parse({
        ...original,
        isCurrent: owner.head(tx, projectId, storyboard.id) === original.id,
        sourceState: "unavailable",
        sourceReasons: [],
      });
      const {
        sourceFingerprint,
        baseAttributionId: _base,
        ...sourceBody
      } = value.source;
      if (
        storyboardAttributionSourceHash(sourceBody) !== sourceFingerprint ||
        storyboardAttributionHash({
          sourceFingerprint,
          selections: value.input.selections,
          links: value.links,
          coverage: value.coverage,
        }) !== value.associationFingerprint
      )
        throw new AttributionImpactError(
          503,
          "指定原关联的持久来源／链接指纹不一致，不重建或补最新关联。",
        );
      const script = owner.readResult(tx, value.source.script.id);
      const validScript =
        script?.projectId === projectId &&
        script.episodeId === storyboard.episodeId &&
        script.version === value.source.script.version &&
        script.content.kind === "episode-script" &&
        storyboardAttributionHash(script) === value.source.script.contentHash;
      const records = new Map<
        string,
        StoryboardAttributionImpactLink["records"]["scene"]
      >();
      for (const shot of value.source.shots) {
        for (const [kind, stableId, frozen] of [
          ["scenes", shot.sceneId, shot.sceneRecord],
          ["shots", shot.shotId, shot.shotRecord],
        ] as const) {
          if (records.has(frozen.id)) continue;
          let observation: StoryboardAttributionImpactLink["records"]["scene"];
          try {
            const row = tx.get<
              BaselineRecordRow & { retired_at: string | null }
            >(
              "SELECT id,project_id,kind,version,title,parent_id,order_index,payload_json,retired_at FROM production_records WHERE id=? AND project_id=? AND kind=?",
              frozen.id,
              projectId,
              kind,
            );
            const current = row
              ? {
                  id: row.id,
                  version: row.version,
                  retired: row.retired_at !== null,
                  contentHash: captureProductionRecordBaseline({
                    row,
                    binding: {
                      id: row.id,
                      version: row.version,
                      stableId,
                      kind,
                    },
                    projectId,
                    result: { id: storyboard.id, version: storyboard.version },
                  }).contentHash,
                }
              : null;
            observation = {
              frozen,
              current,
              readState: "available",
              change: !current
                ? "missing"
                : current.retired
                  ? "retired"
                  : current.version !== frozen.version ||
                      current.contentHash !== frozen.contentHash
                    ? "changed"
                    : "same-reference",
            };
          } catch {
            observation = {
              frozen,
              current: null,
              readState: "unavailable",
              change: "unavailable",
            };
          }
          records.set(frozen.id, observation);
        }
      }
      return {
        value,
        frozenBlocks:
          validScript && script?.content.kind === "episode-script"
            ? script.content.value.blocks
            : undefined,
        records,
      };
    });
    const { value, records } = captured;
    let entries: AgentContextEntry[] | undefined;
    try {
      const snapshot = optionalService(
        context,
        AGENT_CONTEXT_SERVICE,
      )?.getSnapshot(value.source.outline.sourceSnapshotId);
      if (snapshot?.projectId === projectId) entries = snapshot.entries;
    } catch {
      /* Exact frozen source unavailable, not a cache replacement. */
    }
    const screenplays = optionalService(
      context,
      PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
    );
    let currentBlocks: { id: string; type: string }[] | undefined;
    try {
      const current = screenplays?.get(
        projectId,
        value.source.document.scriptId,
      );
      if (
        current?.projectId === projectId &&
        current.scriptId === value.source.document.scriptId &&
        current.source.state === "available" &&
        current.source.document.id === value.source.document.id
      )
        currentBlocks = current.source.document.blocks;
    } catch {
      /* Metadata will retain unknown, not original cached blocks. */
    }
    const blockMap = (blocks: { id: string; type: string }[] | undefined) =>
      new Map(
        blocks?.map((b, index) => [
          b.id,
          {
            id: b.id,
            type: b.type,
            index,
            contentHash: storyboardAttributionHash(b),
          },
        ]),
      );
    const oldBlocks = blockMap(captured.frozenBlocks),
      actualBlocks = blockMap(currentBlocks);
    const expressions = new Map<string, AttributionExpressionRead>();
    const readExpression = (
      link: StoryboardAttribution["links"][number],
    ): AttributionExpressionRead => {
      const e = link.evidence,
        ref = e.source;
      const key = JSON.stringify([
        attributionExpressionKey(ref),
        e.valuePath,
        e.paragraphId ?? null,
        e.sourceBlockId ?? null,
      ]);
      const cached = expressions.get(key);
      if (cached) return cached;
      let actual: AttributionExpressionRead = unavailable();
      try {
        if (ref.sourceKind === "chapter") {
          const service = optionalService(context, WRITING_CHAPTER_SERVICE);
          if (service) {
            const chapter = service.get(ref.sourceId);
            if (!chapter || chapter.projectId !== projectId)
              actual = { readState: "missing", version: null };
            else {
              actual = {
                readState: "available",
                version: chapter.version,
                text: chapter.content,
              };
              if (e.paragraphId) {
                const index = optionalService(
                  context,
                  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
                );
                const detail = index?.chapter(projectId, chapter.id);
                if (
                  !detail ||
                  detail.projectId !== projectId ||
                  detail.chapter.version !== chapter.version
                )
                  actual = unavailable();
                else {
                  const paragraph = detail.paragraphs.find(
                    (p) => p.id === e.paragraphId,
                  );
                  actual.paragraph = {
                    id: e.paragraphId,
                    present: Boolean(paragraph),
                    start: paragraph?.start ?? null,
                    end: paragraph?.end ?? null,
                  };
                }
              }
            }
          }
        } else if (ref.sourceKind === "project") {
          const service = optionalService(context, WORKSPACE_PROJECT_SERVICE);
          if (service) {
            const project = service.get(ref.sourceId);
            if (!project || project.id !== projectId)
              actual = { readState: "missing", version: null };
            else {
              const text =
                e.valuePath === "/content/synopsis"
                  ? project.synopsis
                  : e.valuePath === "/content/productionBrief"
                    ? project.productionBrief
                    : undefined;
              actual = {
                readState:
                  typeof text === "string" ? "available" : "unverified",
                version: project.version,
                text,
              };
            }
          }
        } else if (ref.sourceKind === "production") {
          const saved = screenplays?.get(projectId, ref.sourceId);
          if (screenplays && !saved)
            actual = { readState: "missing", version: null };
          else if (
            saved?.projectId === projectId &&
            saved.source.state === "available"
          ) {
            const originalDocument = value.source.originalScriptDocument;
            if (
              originalDocument &&
              originalDocument.scriptId === ref.sourceId &&
              saved.source.document.id !== originalDocument.id
            )
              actual = {
                readState: "unverified",
                version: saved.scriptVersion,
              };
            else if (e.sourceBlockId) {
              const index = saved.source.document.blocks.findIndex(
                  (b) => b.id === e.sourceBlockId,
                ),
                block = saved.source.document.blocks[index];
              actual = block
                ? {
                    readState:
                      ["action", "dialogue"].includes(block.type) &&
                      "text" in block
                        ? "available"
                        : "unverified",
                    version: saved.scriptVersion,
                    text: "text" in block ? block.text : undefined,
                    sourceBlock: { id: block.id, index, type: block.type },
                  }
                : { readState: "missing", version: saved.scriptVersion };
            } else {
              const row = optionalService(
                context,
                PRODUCTION_RECORD_SERVICE,
              )?.get(ref.sourceId);
              const expression =
                row?.projectId === projectId && row.kind === "scripts"
                  ? directScriptSourceContent(row.payload["剧本内容"], {
                      version: saved.source.document.version,
                      blocks_json: JSON.stringify(saved.source.document.blocks),
                      source_format: saved.source.document.sourceFormat,
                      loss_report_json: JSON.stringify(
                        saved.source.document.lossReport,
                      ),
                    })
                  : undefined;
              actual = expression
                ? {
                    readState: "available",
                    version: saved.scriptVersion,
                    text: expression.content,
                  }
                : { readState: "unverified", version: saved.scriptVersion };
            }
          }
        } else if (ref.sourceKind === "knowledge") {
          if (ref.fieldPath === `/narrative-summaries/${ref.sourceId}`) {
            const service = optionalService(
              context,
              KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
            );
            if (service) {
              const summary = service.get(projectId, ref.sourceId);
              actual = !summary
                ? { readState: "missing", version: null }
                : summary.projectId === projectId &&
                    summary.status === "adopted"
                  ? {
                      readState: "available",
                      version: summary.version,
                      text: summary.content.summary,
                    }
                  : { readState: "unverified", version: summary.version };
            }
          } else {
            const frozen = entries?.find(
              (entry) =>
                entry.included &&
                attributionExpressionKey(entry) ===
                  attributionExpressionKey(ref),
            );
            const chapter = object(object(frozen?.value).sourceChapter);
            const index = optionalService(
              context,
              KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
            );
            if (index && typeof chapter.id === "string") {
              const detail = index.chapter(projectId, chapter.id);
              const summary =
                detail?.projectId === projectId
                  ? detail.summaries.find((s) => s.id === ref.sourceId)
                  : undefined;
              const excluded = detail?.excluded.find(
                (s) => s.id === ref.sourceId,
              );
              // Exclusion is not deletion; never manufacture a missing record.
              actual = summary
                ? {
                    readState: "available",
                    version: summary.version,
                    text: summary.text,
                  }
                : {
                    readState: "unverified",
                    version: excluded?.version ?? null,
                  };
            }
          }
        }
      } catch {
        actual = unavailable();
      }
      expressions.set(key, actual);
      return actual;
    };
    const nodes = new Map<string, StoryboardAttributionImpactLink["node"]>();
    const links = value.links.map(
      (original, index): StoryboardAttributionImpactLink => {
        const comparison = compareAttributionQuote({
          link: original,
          frozenEntries: entries,
          current: readExpression(original),
        });
        const reasonCodes = [...comparison.reasonCodes];
        const blocks = original.blockIds.map(
          (id): StoryboardAttributionImpactLink["blocks"][number] => {
            const frozen = oldBlocks.get(id) ?? null,
              current = actualBlocks.get(id) ?? null;
            const readState =
              captured.frozenBlocks && currentBlocks
                ? "available"
                : "unavailable";
            const change =
              readState === "unavailable" || !frozen
                ? "unavailable"
                : !current
                  ? "missing"
                  : frozen.contentHash !== current.contentHash
                    ? "changed"
                    : frozen.index !== current.index
                      ? "reordered"
                      : "same-reference";
            if (change !== "same-reference")
              reasonCodes.push(`script-block-${change}`);
            if (
              frozen &&
              current &&
              frozen.index !== current.index &&
              change !== "reordered"
            )
              reasonCodes.push("script-block-reordered");
            return {
              id,
              frozen,
              current: readState === "unavailable" ? null : current,
              readState,
              change,
            };
          },
        );
        const shot = value.source.shots.find(
          (s) => s.sceneId === original.sceneId && s.shotId === original.shotId,
        )!;
        const actualRecords = {
          scene: records.get(shot.sceneRecord.id)!,
          shot: records.get(shot.shotRecord.id)!,
        };
        for (const name of ["scene", "shot"] as const)
          if (actualRecords[name].change !== "same-reference")
            reasonCodes.push(`${name}-record-${actualRecords[name].change}`);
        let node: StoryboardAttributionImpactLink["node"] = null;
        if (original.storyNode) {
          const requested = {
              declaration: original.storyNode.declaration,
              node: original.storyNode.node,
            },
            key = JSON.stringify(requested);
          if (!nodes.has(key)) {
            try {
              const service = optionalService(
                context,
                KNOWLEDGE_STORY_NODE_OBSERVATION_SERVICE,
              );
              if (!service) throw new Error("Unavailable owner");
              const observation = StoryNodeObservationSchema.parse(
                service.observe(projectId, requested),
              );
              if (
                observation.projectId !== projectId ||
                JSON.stringify(observation.requested) !== key
              )
                throw new Error("Wrong exact owner identity");
              nodes.set(key, {
                readState: "available",
                observation,
                referenceComparison:
                  observation.referenceHash === original.storyNode.referenceHash
                    ? "same-reference"
                    : "changed",
              });
            } catch {
              nodes.set(key, {
                readState: "unavailable",
                observation: null,
                referenceComparison: "unavailable",
              });
            }
          }
          node = nodes.get(key)!;
          if (node?.readState === "unavailable")
            reasonCodes.push("story-node-unavailable");
          else if (node?.observation) {
            reasonCodes.push(...node.observation.reasonCodes);
            if (node.referenceComparison === "changed")
              reasonCodes.push("story-node-reference-changed");
          }
        }
        const unique = [...new Set(reasonCodes)];
        return {
          index,
          original,
          quote: comparison.quote,
          blocks,
          records: actualRecords,
          node,
          reasonCodes: unique,
          associationImpact: attributionImpactState(unique),
        };
      },
    );
    return StoryboardAttributionImpactSchema.parse({
      format: "exact-shot-attribution-impact-v1",
      projectId,
      episodeId: storyboard.episodeId,
      attribution: { id: value.id, version: value.version },
      storyboard: { id: storyboard.id, version: storyboard.version },
      isCurrent: value.isCurrent,
      sourceFingerprint: value.source.sourceFingerprint,
      associationFingerprint: value.associationFingerprint,
      coverage: value.coverage,
      links,
      textIncluded: false,
      semanticVerification: "unverified",
      automaticRedo: false,
    });
  };
}
