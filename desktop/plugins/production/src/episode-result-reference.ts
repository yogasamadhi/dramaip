import { createHash } from "node:crypto";
import { creationReference } from "@dramaip/contracts/creation";
import type { EpisodeDevelopmentBasis } from "@dramaip/contracts/production";
import type { FormalEpisodeResult } from "./episode-formal-ancestry.js";

/** The owner's canonical formal value, shared by adoption and ancestry reads.
 * A newly adopted human result is not retroactively a model input. */
export function episodeResultReference(value: FormalEpisodeResult) {
  const reference = creationReference(value.operation, {
    id: value.id,
    version: value.version,
    projectId: value.projectId,
    title:
      value.operation === "episode-outline"
        ? "已采用单集大纲"
        : "已采用标准剧本",
    content: value.content,
    ...(value.origin === "human-script-revision"
      ? { origin: value.origin, scriptRevision: value.scriptRevision }
      : value.origin === "human-source-revision"
        ? { origin: value.origin, sourceRevision: value.sourceRevision }
        : value.origin === "human-topology-revision"
          ? { origin: value.origin, topologyRevision: value.topologyRevision }
          : {}),
    ...(value.sourceEvidence ? { sourceEvidence: value.sourceEvidence } : {}),
  });
  if (value.sourceRevision)
    reference.policyDependencies = value.sourceRevision.policyDependencies;
  return reference;
}

export function frozenEpisodeResultReference(
  value: FormalEpisodeResult,
): EpisodeDevelopmentBasis["references"][number] {
  const reference = episodeResultReference(value);
  return {
    sourceKind:
      reference.sourceKind as EpisodeDevelopmentBasis["references"][number]["sourceKind"],
    sourceId: reference.sourceId,
    sourceVersion: reference.sourceVersion,
    fieldPath: reference.fieldPath,
    contentHash: createHash("sha256")
      .update(JSON.stringify(reference.value))
      .digest("hex"),
  };
}
