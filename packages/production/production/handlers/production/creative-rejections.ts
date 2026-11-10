import { createHash } from "node:crypto";
import {
  CreationSourceChangeSchema,
  type CreationSourceChange,
} from "@dramaip/contracts/creation";
import {
  CreativeOwnerRejectionFactSchema,
  CreativeChapterCollectionChangeSchema,
  canonicalCreativeMetricJSON,
  type CreativeOwnerRejectionFact,
  type CreativeChapterCollectionChange,
} from "@dramaip/contracts/insights";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";

/** Only an actually read identity/version difference; never stale text or absence. */
export function observedCreativeSourceChange(
  sourceKind: "author_intent" | "chapter" | "production",
  frozen: { id: string; version: number },
  current: { id: string; version: number } | undefined,
): CreationSourceChange[] {
  const change = CreationSourceChangeSchema.safeParse({
    sourceKind,
    frozen: { id: frozen.id, version: frozen.version },
    current: current ? { id: current.id, version: current.version } : undefined,
  });
  return change.success ? [change.data] : [];
}

export function observedCreativeChapterChanges(
  frozen: readonly { id: string; version: number }[],
  current: readonly { id: string; version: number }[] | undefined,
): CreationSourceChange[] {
  return frozen.flatMap((source) =>
    observedCreativeSourceChange(
      "chapter",
      source,
      current?.find((item) => item.id === source.id),
    ),
  );
}

/** Only a complete Writing service list and a validated original whole-book basis. */
export function observedCreativeWholeBookCollection(
  projectId: string,
  basis: { scope: string; chapters: readonly { id: string }[] },
  current:
    readonly { id: string; projectId: string; content: string }[] | undefined,
): CreativeChapterCollectionChange | undefined {
  if (
    basis.scope !== "whole-book" ||
    current === undefined ||
    current.some(
      (item) =>
        item.projectId !== projectId || typeof item.content !== "string",
    )
  )
    return undefined;
  const observed = CreativeChapterCollectionChangeSchema.safeParse({
    scope: "whole-book",
    inventory: "nonempty-chapters",
    inventoryOwner: "writing",
    completeness: "complete-owner-inventory",
    frozenIds: basis.chapters.map((source) => source.id).sort(),
    currentIds: current
      .filter((item) => item.content.trim())
      .map((item) => item.id)
      .sort(),
  });
  return observed.success ? observed.data : undefined;
}

/** All service observations must precede the owner's status/idempotency UOW. */
export function recordProductionCreativeRejection(
  tx: UnitOfWorkTransaction,
  metric: CreativeOwnerRejectionFact["metric"],
  value: {
    id: string;
    projectId: string;
    workflowId: string;
    stateVersion: number;
    status: string;
    content: unknown;
  },
  changes: CreationSourceChange[],
  evidence?: {
    selectionOptions?: readonly { id: string }[];
    chapterCollection?: CreativeChapterCollectionChange;
  },
): void {
  if (value.status !== "conflicted")
    throw new Error("Only an actual committed native rejection is measurable.");
  const fingerprint = (material: unknown) =>
    createHash("sha256")
      .update(canonicalCreativeMetricJSON(material))
      .digest("hex");
  const payload = CreativeOwnerRejectionFactSchema.parse({
    eventVersion: 1,
    kind: "owner-rejection",
    projectId: value.projectId,
    workflowId: value.workflowId,
    workflowPath: "adaptation",
    metric,
    candidate: {
      id: value.id,
      contentFingerprint: fingerprint(value.content),
      ...(evidence?.selectionOptions
        ? {
            selectionOptions: evidence.selectionOptions.map((option) => ({
              id: option.id,
              contentFingerprint: fingerprint(option),
            })),
          }
        : {}),
    },
    ownerRejection: {
      owner: "production",
      aggregateType: {
        "adaptation.diagnosis": "adaptation-diagnosis",
        "adaptation.strategy": "adaptation-strategy",
        "adaptation.season-plan": "season-plan",
      }[metric],
      stateVersion: value.stateVersion,
    },
    ...(changes.length || evidence?.chapterCollection
      ? {
          sourceConflict: {
            projectId: value.projectId,
            workflowId: value.workflowId,
            changes,
            ...(evidence?.chapterCollection
              ? { chapterCollection: evidence.chapterCollection }
              : {}),
          },
        }
      : {}),
    evidenceKind: "rule",
    modelEvidence: "unknown",
  });
  tx.append({
    type: "production.creative-adoption-rejected.v1",
    pluginId: "production",
    aggregateType: payload.ownerRejection.aggregateType,
    aggregateId: value.id,
    aggregateVersion: value.stateVersion,
    payload,
  });
}
