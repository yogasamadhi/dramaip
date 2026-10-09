import { createHash } from "node:crypto";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  episodeConstraintChange,
  type EpisodeDevelopmentBasis,
  type EpisodeUpstreamConstraint,
  type EpisodeConstraintSnapshot,
} from "@dramaip/contracts/production";
import { creationReference } from "@dramaip/contracts/creation";

type Kind = EpisodeUpstreamConstraint["kind"];
type Ref = { id: string; version: number };
export function observeConstraintRead<T>(reader: (() => T) | undefined): {
  readState: "available" | "unavailable";
  value: T | undefined;
} {
  if (!reader) return { readState: "unavailable", value: undefined };
  try {
    return { readState: "available", value: reader() };
  } catch {
    // Owner exception messages can contain source prose or paths. Never project them.
    return { readState: "unavailable", value: undefined };
  }
}

/** Body-free projection only. It never fetches a replacement, writes or clears gates. */
export function observeEpisodeConstraint(input: {
  basis: Pick<EpisodeDevelopmentBasis, "references">;
  kind: Kind;
  frozen: Ref | null;
  current: AgentContextReference | undefined;
  readState: "available" | "unavailable";
  currentSourceState?: "current" | "stale" | "unverified";
  frozenPosition?: number;
  currentPosition?: number;
  frozenDocumentVersion?: number | null;
  currentDocumentVersion?: number | null;
}): EpisodeUpstreamConstraint {
  const kind =
    input.kind === "direct-project"
      ? "project"
      : input.kind === "direct-episode"
        ? "episode-directory"
        : input.kind === "direct-source-script"
          ? "source-script"
          : input.kind === "story-bible"
            ? "knowledge"
            : input.kind;
  const expectedPath = input.frozen && creationReference(kind, input.frozen);
  const candidates = expectedPath
    ? input.basis.references.filter(
        (item) =>
          item.sourceKind === expectedPath.sourceKind &&
          item.sourceId === expectedPath.sourceId &&
          item.sourceVersion === expectedPath.sourceVersion &&
          item.fieldPath === expectedPath.fieldPath,
      )
    : [];
  const frozen: EpisodeConstraintSnapshot | null = input.frozen
    ? {
        id: input.frozen.id,
        version: input.frozen.version,
        contentHash:
          candidates.length === 1 ? candidates[0]!.contentHash : null,
        ...(input.frozenPosition === undefined
          ? {}
          : { position: input.frozenPosition }),
        ...(input.frozenDocumentVersion === undefined
          ? {}
          : { documentVersion: input.frozenDocumentVersion }),
      }
    : null;
  const current: EpisodeConstraintSnapshot | null =
    input.readState === "available" && input.current
      ? {
          id: input.current.sourceId,
          version: input.current.sourceVersion,
          contentHash: createHash("sha256")
            .update(JSON.stringify(input.current.value))
            .digest("hex"),
          ...(input.currentPosition === undefined
            ? {}
            : { position: input.currentPosition }),
          ...(input.currentDocumentVersion === undefined
            ? {}
            : { documentVersion: input.currentDocumentVersion }),
        }
      : null;
  return {
    kind: input.kind,
    frozen,
    current,
    readState: input.readState,
    currentSourceState: current
      ? (input.currentSourceState ?? "unverified")
      : null,
    change: episodeConstraintChange({
      frozen,
      current,
      readState: input.readState,
    }),
  };
}
