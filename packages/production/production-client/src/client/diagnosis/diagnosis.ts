import type {
  CreationGetResult,
  CreationStartInput,
} from "@dramaip/automation-automation/types";
import type {
  DiagnosesGetResult,
  DiagnosesSourcesResult,
} from "@dramaip/production-production/types";
import {
  HASH,
  integer,
  isObject,
  isRef,
  onlyKeys,
  parseNarrativeContext,
  sameFrozenSnapshot,
  UUID,
  type NarrativeContextRequest,
} from "../tools/parse.ts";

export type Diagnosis = DiagnosesGetResult;
export type DiagnosisCatalog = DiagnosesSourcesResult;
export type DiagnosisRequest = NonNullable<
  CreationStartInput["diagnosisRequest"]
>;
export type DiagnosisTarget = DiagnosisRequest["target"];
export type Workflow = CreationGetResult;

/** Why a scope could not be confirmed. */
export type DiagnosisRequestError = "intent" | "invalid" | "whole-book";

/** The storage key of a project's confirmed diagnosis scope. */
export const diagnosisDraftKey = (projectId: string) =>
  `dramaip-diagnosis-scope:${projectId}`;

const REQUEST_KEYS = [
  "scope",
  "chapters",
  "inventoryFingerprint",
  "authorIntent",
  "baseAdoptedId",
  "rightsDeclared",
  "target",
  "context",
] as const;

/** A target the owner takes: 1–120 episodes of 30–1800 seconds. */
export function validTarget(target: unknown): target is DiagnosisTarget {
  return (
    isObject(target) &&
    onlyKeys(target, ["format", "episodeCount", "durationSeconds"]) &&
    (target.format === "short-drama" || target.format === "motion-comic") &&
    integer(target.episodeCount, 1, 120) &&
    integer(target.durationSeconds, 30, 1800)
  );
}

/**
 * A diagnosis request exactly as the owner takes it, or undefined: 1–1000
 * chapter references, the inventory fingerprint, the adopted author intent,
 * the rights declaration and a valid target, with nothing else.
 */
export function parseDiagnosisRequest(
  item: unknown,
): DiagnosisRequest | undefined {
  if (!isObject(item) || !onlyKeys(item, REQUEST_KEYS)) return undefined;
  const { chapters, authorIntent, baseAdoptedId, context } = item;
  const valid =
    (item.scope === "whole-book" || item.scope === "selected-chapters") &&
    Array.isArray(chapters) &&
    chapters.length >= 1 &&
    chapters.length <= 1000 &&
    chapters.every(
      (chapter: unknown) =>
        isRef(chapter) &&
        onlyKeys(chapter as Record<string, unknown>, ["id", "version"]),
    ) &&
    typeof item.inventoryFingerprint === "string" &&
    HASH.test(item.inventoryFingerprint) &&
    isRef(authorIntent) &&
    onlyKeys(authorIntent as Record<string, unknown>, ["id", "version"]) &&
    authorIntent.version >= 1 &&
    (baseAdoptedId === undefined ||
      (typeof baseAdoptedId === "string" && UUID.test(baseAdoptedId))) &&
    item.rightsDeclared === true &&
    validTarget(item.target) &&
    (context === undefined || parseNarrativeContext(context) !== undefined);
  return valid ? (item as unknown as DiagnosisRequest) : undefined;
}

/** The scope saved for a project, when it still parses. */
export function readDiagnosisDraft(
  raw: string | null,
): DiagnosisRequest | undefined {
  try {
    return parseDiagnosisRequest(JSON.parse(raw ?? "null"));
  } catch {
    return undefined;
  }
}

/**
 * The scope the author confirmed, frozen to the catalog read: the chosen
 * chapters in catalog order, the adopted author intent and base, the
 * rights declaration and target, and the mixed expressions when asked
 * for. A whole-book scope must name every non-empty chapter.
 */
export function confirmDiagnosisRequest(
  catalog: DiagnosisCatalog,
  choice: {
    scope: DiagnosisRequest["scope"];
    selected: readonly string[];
    rights: boolean;
    target: DiagnosisTarget;
    context?: NarrativeContextRequest | undefined;
  },
): { request: DiagnosisRequest } | { error: DiagnosisRequestError } {
  if (!catalog.authorIntent) return { error: "intent" };
  const request = parseDiagnosisRequest({
    scope: choice.scope,
    chapters: catalog.chapters
      .filter((item) => choice.selected.includes(item.id))
      .map(({ id, version }) => ({ id, version })),
    inventoryFingerprint: catalog.inventoryFingerprint,
    authorIntent: catalog.authorIntent,
    ...(catalog.adoptedDiagnosisId === undefined
      ? {}
      : { baseAdoptedId: catalog.adoptedDiagnosisId }),
    rightsDeclared: choice.rights,
    target: choice.target,
    ...(choice.context ? { context: choice.context } : {}),
  });
  if (!request) return { error: "invalid" };
  if (
    choice.scope === "whole-book" &&
    request.chapters.length !== catalog.chapters.length
  )
    return { error: "whole-book" };
  return { request };
}

/** The diagnosis run a link names, when it is this project's with a request. */
export function originalDiagnosisWorkflow(
  workflow: Workflow | undefined,
  requested: { projectId: string; workflowId: string },
): Workflow | undefined {
  return workflow &&
    workflow.id === requested.workflowId &&
    workflow.input.projectId === requested.projectId &&
    workflow.input.operation === "adaptation-diagnosis" &&
    workflow.input.diagnosisRequest
    ? workflow
    : undefined;
}

/**
 * The diagnosis a link names: this project's, the named one and, with a
 * run named, the one that run produced from exactly its frozen basis.
 */
export function originalDiagnosisCandidate(
  diagnosis: Diagnosis | undefined,
  requested: { projectId: string; diagnosisId?: string; workflowId?: string },
  workflow?: Workflow,
): Diagnosis | undefined {
  if (
    !diagnosis ||
    diagnosis.projectId !== requested.projectId ||
    (requested.diagnosisId !== undefined &&
      diagnosis.id !== requested.diagnosisId)
  )
    return undefined;
  if (!requested.workflowId) return diagnosis;
  return diagnosis.workflowId === requested.workflowId &&
    workflow?.diagnosisId === diagnosis.id &&
    sameFrozenSnapshot(workflow.diagnosisBasis, diagnosis.basis)
    ? diagnosis
    : undefined;
}
