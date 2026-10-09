import { createHash } from "node:crypto";
import {
  EpisodeScriptRevisionReceiptSchema,
  EpisodeTopologyRevisionReceiptSchema,
  EpisodeSourceRevisionReceiptSchema,
  EpisodeDevelopmentBasisSchema,
  type EpisodeDevelopmentResult,
  type EpisodeDevelopmentBasis,
  type EpisodeScriptRevision,
  type EpisodeTopologyRevision,
  type EpisodeSourceRevision,
} from "@dramaip/contracts/production";
import {
  AgentContextSnapshotSchema,
  agentContextManifestJSON,
  type AgentContextSnapshot,
} from "@dramaip/contracts/agent-context";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";

export type FormalEpisodeResult = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type ScriptRevision = Omit<
  EpisodeScriptRevision,
  "sourceState" | "staleReasons"
>;
type TopologyRevision = Omit<
  EpisodeTopologyRevision,
  "sourceState" | "staleReasons"
>;
type SourceRevision = Omit<
  EpisodeSourceRevision,
  "sourceState" | "staleReasons"
>;
type PolicyDependency = {
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
};
const hash = (value: unknown) =>
  createHash("sha256")
    // Optional evidence may genuinely be absent on both real records. Frame
    // that absence separately from every JSON value; never pass undefined to
    // the hashing API, nor equate absence with an empty evidence array.
    .update(JSON.stringify(value) ?? "\u0000undefined")
    .digest("hex");
const canonicalJson = agentContextManifestJSON;
export class EpisodeFormalAncestryError extends Error {}
class EpisodeFormalAncestryReadError extends Error {}
function readActual<T>(read: () => T): T {
  try {
    return read();
  } catch {
    // An owner's failed read is not proof that the original content changed.
    // Preserve the unavailable boundary without exposing its private cause.
    throw new EpisodeFormalAncestryReadError("实际正式祖先读取暂不可用。");
  }
}
function fail(): never {
  // This error is deliberately body-free; callers must not leak parser errors,
  // private explanations, ancestor content or snapshot prompts to the client.
  throw new EpisodeFormalAncestryError(
    "实际正式祖先、原采用回执或冻结快照未核全；不推定来源链。",
  );
}
const ref = (value: FormalEpisodeResult) => ({
  id: value.id,
  version: value.version,
});

/** Immutable owner rows only. Current heads, current source eligibility and
 * actual records are separate checks. This does NOT authorize a local redo:
 * the complete impact observation and author selection must also be bound.
 * Each human hop requires its real adopted preview; a matching receipt alone
 * is not an adoption, and a model rerun is not guessed to be a human ancestor. */
export function inspectEpisodeFormalAncestry(input: {
  script: FormalEpisodeResult;
  outline: FormalEpisodeResult;
  read(id: string): FormalEpisodeResult | undefined;
  readScriptRevision(id: string): ScriptRevision | undefined;
  readTopologyRevision(id: string): TopologyRevision | undefined;
  readSourceRevision(id: string): SourceRevision | undefined;
  formalReference(
    value: FormalEpisodeResult,
  ): EpisodeDevelopmentBasis["references"][number];
}) {
  try {
    const first = input.script;
    if (!first.scriptId || !first.episodeRecordId) fail();
    const valid = (
      value: FormalEpisodeResult | undefined,
      kind: "episode-script" | "episode-outline",
      binding?: FormalEpisodeResult,
    ) => {
      if (
        !value ||
        value.operation !== kind ||
        value.content.kind !== kind ||
        value.projectId !== first.projectId ||
        value.episodeId !== first.episodeId ||
        value.basis.episode.id !== first.episodeId ||
        !Number.isSafeInteger(value.version) ||
        value.version < 1 ||
        (kind === "episode-script" &&
          (!value.scriptId ||
            !value.episodeRecordId ||
            (binding &&
              (value.scriptId !== binding.scriptId ||
                value.episodeRecordId !== binding.episodeRecordId)) ||
            value.scriptDocumentVersion === undefined))
      )
        fail();
      return value;
    };
    const parentPair = (
      scriptRef: { id: string; version: number },
      outlineRef: { id: string; version: number },
      binding: FormalEpisodeResult,
    ) => {
      const script = valid(
          readActual(() => input.read(scriptRef.id)),
          "episode-script",
          binding,
        ),
        outline = valid(
          readActual(() => input.read(outlineRef.id)),
          "episode-outline",
        );
      if (
        script.version !== scriptRef.version ||
        outline.version !== outlineRef.version
      )
        fail();
      return { script, outline };
    };
    const pairs: {
      script: FormalEpisodeResult;
      outline: FormalEpisodeResult;
      role: "current-confirmation-chain" | "outline-provenance";
    }[] = [];
    const sourcePreviews: SourceRevision[] = [];
    const previewReferences: PolicyDependency[] = [];
    const edges: {
      from: string;
      to: string;
      kind: "human-confirmation-parent" | "outline-provenance";
    }[] = [];
    const seen = new Map<string, string>();
    const pending: {
      script: FormalEpisodeResult;
      outline: FormalEpisodeResult;
      role: "current-confirmation-chain" | "outline-provenance";
    }[] = [
      {
        script: input.script,
        outline: input.outline,
        role: "current-confirmation-chain",
      },
    ];
    const branches: {
      entryScriptId: string;
      role: "current-confirmation-chain" | "outline-provenance";
      scriptId: string;
      episodeRecordId: string;
      documentId: string | undefined;
    }[] = [];
    while (pending.length) {
      const start = pending.pop()!;
      const branch = new Set<string>();
      const documentIds: string[] = [];
      let script = valid(start.script, "episode-script"),
        outline = valid(start.outline, "episode-outline");
      while (true) {
        if (
          branch.has(script.id) ||
          script.id === outline.id ||
          hash(script.basis.request.outline) !== hash(ref(outline)) ||
          script.content.kind !== "episode-script" ||
          outline.content.kind !== "episode-outline"
        )
          fail();
        branch.add(script.id);
        if (seen.has(script.id)) {
          if (seen.get(script.id) !== hash({ script, outline })) fail();
          break;
        }
        if (seen.size >= 1000) fail();
        seen.set(script.id, hash({ script, outline }));
        inspectEpisodeScriptContent(
          script.content.value,
          outline.content.value,
        );
        pairs.push({ script, outline, role: start.role });
        if (script.origin === undefined || script.origin === "model") {
          if (
            script.scriptRevision ||
            script.topologyRevision ||
            script.sourceRevision
          )
            fail();
          // A later model script may consume an earlier human-confirmed outline.
          // Its paired human script is provenance, not the model script's parent;
          // verify that branch too instead of ending at this new model run.
          if (
            outline.origin === "human-source-revision" ||
            outline.origin === "human-topology-revision"
          ) {
            const receipt =
              outline.origin === "human-source-revision"
                ? EpisodeSourceRevisionReceiptSchema.parse(
                    outline.sourceRevision,
                  )
                : EpisodeTopologyRevisionReceiptSchema.parse(
                    outline.topologyRevision,
                  );
            if (hash(receipt.results.outline) !== hash(ref(outline))) fail();
            const sibling = valid(
              readActual(() => input.read(receipt.results.script.id)),
              "episode-script",
            );
            if (
              sibling.version !== receipt.results.script.version ||
              sibling.origin !== outline.origin
            )
              fail();
            pending.push({
              script: sibling,
              outline,
              role: "outline-provenance",
            });
            edges.push({
              from: script.id,
              to: sibling.id,
              kind: "outline-provenance",
            });
          } else if (outline.origin !== undefined && outline.origin !== "model")
            fail();
          break;
        }
        if (script.workflowId || script.runIds.length || script.model) fail();
        if (script.origin === "human-script-revision") {
          if (script.topologyRevision || script.sourceRevision) fail();
          const receipt = EpisodeScriptRevisionReceiptSchema.parse(
              script.scriptRevision,
            ),
            preview = readActual(() =>
              input.readScriptRevision(receipt.previewId),
            );
          if (
            !preview ||
            preview.id !== receipt.previewId ||
            preview.status !== "adopted" ||
            preview.stateVersion !== 1 ||
            preview.projectId !== first.projectId ||
            preview.episodeId !== first.episodeId ||
            preview.resultId !== script.id ||
            hash(preview.sourceResult) !== hash(receipt.sourceResult) ||
            hash(preview.outline) !== hash(ref(outline)) ||
            canonicalJson(preview.document) !==
              canonicalJson(receipt.document) ||
            receipt.document.scriptId !== script.scriptId ||
            receipt.document.version !== script.scriptDocumentVersion ||
            preview.scriptRecordVersion !== receipt.scriptRecordVersion ||
            preview.contentHash !== receipt.contentHash ||
            hash(preview.content) !== receipt.contentHash ||
            hash(script.content.value) !== receipt.contentHash ||
            preview.sourceSnapshotId !== script.sourceSnapshotId ||
            hash(preview.basis) !== hash(script.basis) ||
            hash(preview.confirmation) !== hash(receipt.humanReview)
          )
            fail();
          const parent = parentPair(
            receipt.sourceResult,
            ref(outline),
            start.script,
          );
          if (
            parent.script.sourceSnapshotId !== script.sourceSnapshotId ||
            parent.script.version >= script.version ||
            receipt.document.version <= parent.script.scriptDocumentVersion! ||
            hash(parent.script.basis) !== hash(script.basis)
          )
            fail();
          previewReferences.push({
            sourceId: preview.id,
            sourceVersion: preview.stateVersion,
            fieldPath: `/production/${preview.id}`,
          });
          documentIds.push(receipt.document.id);
          edges.push({
            from: script.id,
            to: parent.script.id,
            kind: "human-confirmation-parent",
          });
          script = parent.script;
        } else if (script.origin === "human-topology-revision") {
          if (
            script.scriptRevision ||
            script.sourceRevision ||
            outline.origin !== "human-topology-revision" ||
            outline.scriptRevision ||
            outline.sourceRevision ||
            outline.workflowId ||
            outline.runIds.length ||
            outline.model
          )
            fail();
          const receipt = EpisodeTopologyRevisionReceiptSchema.parse(
              script.topologyRevision,
            ),
            preview = readActual(() =>
              input.readTopologyRevision(receipt.previewId),
            );
          if (
            !preview ||
            preview.id !== receipt.previewId ||
            preview.projectId !== first.projectId ||
            preview.episodeId !== first.episodeId ||
            preview.status !== "adopted" ||
            preview.stateVersion !== 1 ||
            hash(outline.topologyRevision) !== hash(receipt) ||
            hash(receipt.results) !==
              hash({ outline: ref(outline), script: ref(script) }) ||
            hash(preview.results) !== hash(receipt.results) ||
            hash(preview.sourceScript) !== hash(receipt.sourceScript) ||
            hash(preview.sourceOutline) !== hash(receipt.sourceOutline) ||
            canonicalJson(preview.document) !==
              canonicalJson(receipt.document) ||
            receipt.document.scriptId !== script.scriptId ||
            receipt.document.version !== script.scriptDocumentVersion ||
            preview.scriptRecordVersion !== receipt.scriptRecordVersion ||
            preview.scriptRecordHash !== receipt.scriptRecordHash ||
            preview.scriptContentHash !== receipt.scriptContentHash ||
            preview.outlineContentHash !== receipt.outlineContentHash ||
            hash(preview.scriptContent) !== receipt.scriptContentHash ||
            hash(script.content.value) !== receipt.scriptContentHash ||
            hash(preview.outlineContent) !== receipt.outlineContentHash ||
            hash(outline.content.value) !== receipt.outlineContentHash ||
            hash(preview.inheritedSnapshots) !==
              hash(receipt.inheritedSnapshots) ||
            script.sourceSnapshotId !== receipt.inheritedSnapshots.script ||
            outline.sourceSnapshotId !== receipt.inheritedSnapshots.outline ||
            hash(preview.confirmation) !== hash(receipt.humanReview) ||
            hash(preview.sourceEvidence) !== hash(script.sourceEvidence) ||
            hash(script.sourceEvidence) !== hash(outline.sourceEvidence)
          )
            fail();
          const parent = parentPair(
            receipt.sourceScript,
            receipt.sourceOutline,
            start.script,
          );
          const expected = structuredClone(preview.scriptBasis);
          expected.request.outline = receipt.results.outline;
          expected.references = expected.references.filter(
            (item) =>
              !(
                item.sourceKind === "production" &&
                item.sourceId === receipt.sourceOutline.id
              ),
          );
          expected.references.push(input.formalReference(outline));
          if (
            parent.script.sourceSnapshotId !== script.sourceSnapshotId ||
            parent.outline.sourceSnapshotId !== outline.sourceSnapshotId ||
            parent.script.version >= script.version ||
            parent.outline.version >= outline.version ||
            hash(preview.scriptBasis) !== hash(parent.script.basis) ||
            hash(preview.outlineBasis) !== hash(parent.outline.basis) ||
            hash(outline.basis) !== hash(parent.outline.basis) ||
            hash(EpisodeDevelopmentBasisSchema.parse(expected)) !==
              hash(script.basis) ||
            receipt.document.version <= parent.script.scriptDocumentVersion!
          )
            fail();
          previewReferences.push({
            sourceId: preview.id,
            sourceVersion: preview.stateVersion,
            fieldPath: `/production/${preview.id}`,
          });
          documentIds.push(receipt.document.id);
          edges.push({
            from: script.id,
            to: parent.script.id,
            kind: "human-confirmation-parent",
          });
          script = parent.script;
          outline = parent.outline;
        } else if (script.origin === "human-source-revision") {
          if (
            script.scriptRevision ||
            script.topologyRevision ||
            outline.origin !== "human-source-revision" ||
            outline.scriptRevision ||
            outline.topologyRevision ||
            outline.workflowId ||
            outline.runIds.length ||
            outline.model
          )
            fail();
          const receipt = EpisodeSourceRevisionReceiptSchema.parse(
              script.sourceRevision,
            ),
            preview = readActual(() =>
              input.readSourceRevision(receipt.previewId),
            );
          if (
            !preview ||
            preview.id !== receipt.previewId ||
            preview.projectId !== first.projectId ||
            preview.episodeId !== first.episodeId ||
            preview.status !== "adopted" ||
            preview.stateVersion !== 1 ||
            hash(outline.sourceRevision) !== hash(receipt) ||
            hash(receipt.results) !==
              hash({ outline: ref(outline), script: ref(script) }) ||
            hash(preview.results) !== hash(receipt.results) ||
            hash(preview.sourceScript) !== hash(receipt.sourceScript) ||
            hash(preview.sourceOutline) !== hash(receipt.sourceOutline) ||
            canonicalJson(preview.document) !==
              canonicalJson(receipt.document) ||
            receipt.document.scriptId !== script.scriptId ||
            receipt.document.version !== script.scriptDocumentVersion ||
            preview.scriptRecordVersion !== receipt.scriptRecordVersion ||
            preview.scriptRecordHash !== receipt.scriptRecordHash ||
            preview.outlineContentHash !== receipt.outlineContentHash ||
            preview.scriptContentHash !== receipt.scriptContentHash ||
            hash(preview.outlineContent) !== receipt.outlineContentHash ||
            hash(outline.content.value) !== receipt.outlineContentHash ||
            hash(preview.scriptContent) !== receipt.scriptContentHash ||
            hash(script.content.value) !== receipt.scriptContentHash ||
            preview.sourceBasisHash !== receipt.sourceBasisHash ||
            hash(preview.outlineBasis) !== receipt.sourceBasisHash ||
            hash(outline.basis) !== receipt.sourceBasisHash ||
            preview.sourceSnapshotId !== receipt.sourceSnapshotId ||
            script.sourceSnapshotId !== receipt.sourceSnapshotId ||
            outline.sourceSnapshotId !== receipt.sourceSnapshotId ||
            preview.sourceManifestHash !== receipt.sourceManifestHash ||
            preview.sourcePromptHash !== receipt.sourcePromptHash ||
            hash(preview.policyDependencies) !==
              hash(receipt.policyDependencies) ||
            hash(preview.confirmation) !== hash(receipt.humanReview) ||
            hash(preview.sourceEvidence) !== hash(script.sourceEvidence) ||
            hash(script.sourceEvidence) !== hash(outline.sourceEvidence) ||
            preview.input.sourceVersion !== receipt.sourceScript.version ||
            hash(preview.input.outline) !== hash(receipt.sourceOutline) ||
            preview.input.documentVersion !== receipt.document.version ||
            hash(preview.input.outlineContent) !== receipt.outlineContentHash ||
            hash(preview.input.sceneLinks) !==
              hash(preview.scriptContent.sceneLinks) ||
            hash(preview.input.request) !== hash(preview.outlineBasis.request)
          )
            fail();
          // Reproduce the owner's actual adoption transform. Do not just accept
          // equal source IDs, a matching body, or a newly fabricated basis.
          const expected = structuredClone(preview.outlineBasis);
          delete expected.request.baseOutlineId;
          expected.request.outline = receipt.results.outline;
          expected.request.baseScriptId = receipt.sourceScript.id;
          expected.request.baseScriptDocumentVersion = receipt.document.version;
          expected.references.push(input.formalReference(outline));
          if (
            hash(EpisodeDevelopmentBasisSchema.parse(expected)) !==
            hash(script.basis)
          )
            fail();
          const parent = parentPair(
            receipt.sourceScript,
            receipt.sourceOutline,
            start.script,
          );
          if (
            receipt.document.version < parent.script.scriptDocumentVersion! ||
            parent.script.version >= script.version ||
            parent.outline.version >= outline.version ||
            Boolean(parent.outline.basis.request.direct) !==
              Boolean(outline.basis.request.direct) ||
            parent.outline.basis.request.direct?.entryPath !==
              outline.basis.request.direct?.entryPath ||
            (receipt.document.version === parent.script.scriptDocumentVersion &&
              parent.script.content.kind === "episode-script" &&
              hash(parent.script.content.value.blocks) !==
                hash(script.content.value.blocks))
          )
            fail();
          previewReferences.push({
            sourceId: preview.id,
            sourceVersion: preview.stateVersion,
            fieldPath: `/production/${preview.id}`,
          });
          documentIds.push(receipt.document.id);
          edges.push({
            from: script.id,
            to: parent.script.id,
            kind: "human-confirmation-parent",
          });
          sourcePreviews.push(preview);
          script = parent.script;
          outline = parent.outline;
        } else fail();
      }
      // Every human confirmation chain stays on one actual saved manuscript.
      // A later model adoption creates a NEW manuscript; the old human outline
      // still has provenance, but is not that new script's human parent chain.
      if (new Set(documentIds).size > 1) fail();
      branches.push({
        entryScriptId: start.script.id,
        role: start.role,
        scriptId: start.script.scriptId!,
        episodeRecordId: start.script.episodeRecordId!,
        documentId: documentIds[0],
      });
    }
    // Shared provenance branches are legitimate; a cycle between branches is
    // not. Do not silently treat the visited-node cache as proof of acyclicity.
    const active = new Set<string>(),
      complete = new Set<string>();
    const inspect = (id: string) => {
      if (active.has(id)) fail();
      if (complete.has(id)) return;
      active.add(id);
      for (const edge of edges) if (edge.from === id) inspect(edge.to);
      active.delete(id);
      complete.add(id);
    };
    for (const id of seen.keys()) inspect(id);
    return {
      pairs,
      sourcePreviews,
      previewReferences,
      documentId: branches.find(
        (branch) => branch.role === "current-confirmation-chain",
      )?.documentId,
      branches,
      edges,
    };
  } catch (error) {
    if (
      error instanceof EpisodeFormalAncestryError ||
      error instanceof EpisodeFormalAncestryReadError
    )
      throw error;
    fail();
  }
}

/** Call the Agents public read API outside the Production UOW. All actual
 * ancestor snapshots are checked, including dependencies not present in the
 * formal basis catalog. Only metadata is returned; no private ancestor body
 * or final prompt is copied to a new source context. */
export function episodeAncestryPolicyDependencies(
  ancestry: ReturnType<typeof inspectEpisodeFormalAncestry>,
  getSnapshot: (id: string) => AgentContextSnapshot | undefined,
  additionalResults: FormalEpisodeResult[] = [],
): PolicyDependency[] {
  try {
    const snapshots = new Map<string, AgentContextSnapshot>();
    const dependencies: PolicyDependency[] = [...ancestry.previewReferences];
    for (const result of [
      ...ancestry.pairs.flatMap(({ script, outline }) => [script, outline]),
      ...additionalResults,
    ]) {
      dependencies.push(
        {
          sourceId: result.id,
          sourceVersion: result.version,
          fieldPath: `/production/${result.id}`,
        },
        ...result.basis.references,
        ...(result.sourceRevision?.policyDependencies ?? []),
      );
      let snapshot = snapshots.get(result.sourceSnapshotId);
      if (!snapshot) {
        const raw = readActual(() => getSnapshot(result.sourceSnapshotId));
        if (!raw) fail();
        snapshot = AgentContextSnapshotSchema.parse(raw);
        if (
          snapshot.id !== result.sourceSnapshotId ||
          snapshot.projectId !== result.projectId ||
          createHash("sha256")
            .update(
              agentContextManifestJSON({
                projectId: snapshot.projectId,
                destination: snapshot.destination,
                tokenBudget: snapshot.tokenBudget,
                entries: snapshot.entries,
              }),
            )
            .digest("hex") !== snapshot.manifestSha256 ||
          createHash("sha256").update(snapshot.finalPrompt).digest("hex") !==
            snapshot.finalPromptSha256
        )
          fail();
        const included = snapshot.entries.filter((entry) => entry.included);
        const keys = included.map((entry) =>
          JSON.stringify([
            entry.sourceKind,
            entry.sourceId,
            entry.sourceVersion,
            entry.fieldPath,
          ]),
        );
        if (
          new Set(keys).size !== keys.length ||
          included.some((entry) => entry.mode === "never")
        )
          fail();
        dependencies.push(
          ...included.flatMap((entry) => [
            {
              sourceId: entry.sourceId,
              sourceVersion: entry.sourceVersion,
              fieldPath: entry.fieldPath,
            },
            ...(entry.policyDependencies ?? []),
          ]),
        );
        snapshots.set(snapshot.id, snapshot);
      }
      const integrity = result.sourceContextIntegrity;
      if (
        snapshot.projectId !== result.projectId ||
        !integrity ||
        integrity.snapshotId !== snapshot.id ||
        integrity.manifestSha256 !== snapshot.manifestSha256 ||
        integrity.finalPromptSha256 !== snapshot.finalPromptSha256
      )
        fail();
      // Human in-place/topology confirmations keep their original snapshot;
      // their added formal refs do not pretend to have been in that model run.
      if (result.origin === undefined || result.origin === "model") {
        if (
          !result.basis.references.every(
            (reference) =>
              snapshot!.entries.filter(
                (entry) =>
                  entry.included &&
                  entry.sourceKind === reference.sourceKind &&
                  entry.sourceId === reference.sourceId &&
                  entry.sourceVersion === reference.sourceVersion &&
                  entry.fieldPath === reference.fieldPath &&
                  hash(entry.value) === reference.contentHash,
              ).length === 1,
          )
        )
          fail();
      }
    }
    for (const preview of ancestry.sourcePreviews) {
      const snapshot = snapshots.get(preview.sourceSnapshotId);
      if (
        !snapshot ||
        snapshot.destination.kind !== "local" ||
        snapshot.destination.provider !== "author-source-review" ||
        snapshot.destination.model !== undefined ||
        snapshot.tokenBudget !== preview.input.tokenBudget ||
        snapshot.manifestSha256 !== preview.sourceManifestHash ||
        snapshot.finalPromptSha256 !== preview.sourcePromptHash ||
        !preview.outlineBasis.references.every(
          (reference) =>
            snapshot.entries.filter(
              (entry) =>
                entry.included &&
                entry.sourceKind === reference.sourceKind &&
                entry.sourceId === reference.sourceId &&
                entry.sourceVersion === reference.sourceVersion &&
                entry.fieldPath === reference.fieldPath &&
                hash(entry.value) === reference.contentHash,
            ).length === 1,
        )
      )
        fail();
      const actualDependencies = [
        ...new Map(
          snapshot.entries
            .filter((entry) => entry.included)
            .flatMap((entry) => entry.policyDependencies ?? [])
            .map((value) => [JSON.stringify(value), value] as const),
        ).values(),
      ];
      if (hash(actualDependencies) !== hash(preview.policyDependencies)) fail();
    }
    const complete = [
      ...new Map(
        dependencies.map(({ sourceId, sourceVersion, fieldPath }) => {
          const value = { sourceId, sourceVersion, fieldPath };
          return [JSON.stringify(value), value] as const;
        }),
      ).values(),
    ];
    // Same strict, finite metadata contract as the actual source receipt.
    // Refuse oversized paths/dependency sets before preparing a new snapshot.
    return EpisodeSourceRevisionReceiptSchema.shape.policyDependencies.parse(
      complete,
    );
  } catch (error) {
    if (
      error instanceof EpisodeFormalAncestryReadError ||
      error instanceof EpisodeFormalAncestryError
    )
      throw error;
    fail();
  }
}
