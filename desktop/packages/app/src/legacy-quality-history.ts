import type {
  CreativeDiagnostic,
  CreativeIssueAcknowledgement,
  EpisodeAnalysis,
} from "@dramaip/contracts/product";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const numbers = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "number" && Number.isFinite(item));
const textFields = (value: Record<string, unknown>, fields: string[]) =>
  fields.every((field) => typeof value[field] === "string");

function diagnostic(value: unknown): value is CreativeDiagnostic {
  return (
    object(value) &&
    textFields(value, [
      "id",
      "projectId",
      "targetTitle",
      "title",
      "summary",
      "sourceFingerprint",
      "createdAt",
    ]) &&
    typeof value.targetKind === "string" &&
    [
      "project",
      "chapter",
      "adaptation",
      "episode",
      "script",
      "scene",
      "shot",
    ].includes(value.targetKind) &&
    typeof value.kind === "string" &&
    [
      "freshness",
      "anti_trope",
      "quality_gate",
      "audience",
      "narrative_curve",
    ].includes(value.kind) &&
    (value.targetId === undefined || typeof value.targetId === "string") &&
    Array.isArray(value.scores) &&
    value.scores.every(
      (item) =>
        object(item) &&
        typeof item.label === "string" &&
        typeof item.value === "number" &&
        Number.isFinite(item.value),
    ) &&
    strings(value.findings) &&
    strings(value.recommendations) &&
    (value.curve === undefined || numbers(value.curve))
  );
}
function acknowledgement(
  value: unknown,
): value is CreativeIssueAcknowledgement {
  return (
    object(value) &&
    textFields(value, [
      "id",
      "projectId",
      "diagnosticId",
      "issueKey",
      "createdAt",
    ]) &&
    typeof value.disposition === "string" &&
    ["accepted", "fixed", "not_applicable"].includes(value.disposition) &&
    (value.note === undefined || typeof value.note === "string") &&
    (value.actorLabel === undefined || typeof value.actorLabel === "string")
  );
}

function ownedHistory<T extends { id: string; projectId: string }>(
  input: unknown,
  projectId: string,
  valid: (value: unknown) => value is T,
): T[] {
  if (!projectId || !Array.isArray(input))
    throw new Error("历史记录响应无效；未使用旧缓存。");
  const ids = new Set<string>();
  const result: T[] = [];
  for (const item of input) {
    if (
      !valid(item) ||
      !item.id.trim() ||
      item.projectId !== projectId ||
      ids.has(item.id)
    )
      throw new Error("历史记录身份或项目不一致；未展示部分响应或旧缓存。");
    ids.add(item.id);
    result.push(item);
  }
  return result;
}

// The wire payload remains historical and unverified. Identity/read validation
// is not content assessment, permission, a current source hash, or a score scale.
export const readLegacyDiagnosticHistory = (
  input: unknown,
  projectId: string,
) => ownedHistory(input, projectId, diagnostic);
export const readLegacyAcknowledgementHistory = (
  input: unknown,
  projectId: string,
) => ownedHistory(input, projectId, acknowledgement);

export const isLegacyQualityTask = (kind: string) =>
  kind === "quality-check" || kind === "creative_diagnostics";

function episodeAnalysis(value: unknown): value is EpisodeAnalysis {
  return (
    object(value) &&
    textFields(value, [
      "id",
      "adaptationId",
      "summary",
      "createdAt",
      "updatedAt",
    ]) &&
    typeof value.episodeCount === "number" &&
    Number.isInteger(value.episodeCount) &&
    numbers([
      value.hookCoverage,
      value.cliffhangerCoverage,
      value.outlineCoverage,
      value.overallScore,
    ]) &&
    strings(value.suggestions)
  );
}
export function readLegacyEpisodeAnalysis(
  input: unknown,
  adaptationId: string,
): EpisodeAnalysis | null {
  // The existing SDK represents an actual 204 as undefined; return an explicit
  // successful empty value so a first read is not confused with "no history".
  if (input === undefined || input === null) return null;
  if (
    !episodeAnalysis(input) ||
    input.adaptationId !== adaptationId ||
    !input.id.trim()
  )
    throw new Error("原分集分析身份或响应无效；未展示其他对象或旧缓存。");
  return input;
}
