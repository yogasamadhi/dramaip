import {
  NarrativeLocalHumanContentSchema,
  type NarrativeLocalQualitySource,
  type NarrativeQualityRequest,
} from "@dramaip/contracts/creative-quality";

export type LocalEvidenceField = {
  sourceId: string;
  sourceVersion: number;
  fieldPath: string;
  valuePath: string;
  text: string;
};
export type LocalIssueDraft = {
  id: string;
  category: NarrativeQualityRequest["dimensions"][number];
  severity: "error" | "warning" | "suggestion";
  message: string;
  suggestion: string;
  field: string;
  quote: string;
};
export const localFieldKey = (field: LocalEvidenceField) =>
  JSON.stringify([
    field.sourceId,
    field.sourceVersion,
    field.fieldPath,
    field.valuePath,
  ]);
export function localTargetReferences(source: NarrativeLocalQualitySource) {
  const { target, chapterScope } = source.basis.request;
  return source.references.filter((entry) =>
    target.kind === "chapter-set"
      ? source.basis.sourceBasis
        ? source.basis.sourceBasis.references.some(
            (ref) =>
              ref.sourceId === entry.sourceId &&
              ref.sourceVersion === entry.sourceVersion &&
              ref.fieldPath === entry.fieldPath,
          )
        : chapterScope?.chapters.some(
            (chapter) =>
              chapter.id === entry.sourceId &&
              chapter.version === entry.sourceVersion,
          )
      : entry.sourceId === target.id && entry.sourceVersion === target.version,
  );
}
export function localEvidenceFields(
  source: NarrativeLocalQualitySource,
): LocalEvidenceField[] {
  const result: LocalEvidenceField[] = [],
    target = source.basis.request.target;
  const escape = (key: string) =>
    key.replace(/~/gu, "~0").replace(/\//gu, "~1");
  for (const reference of localTargetReferences(source)) {
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        let allowed =
          /^\/(?:content|payload)(?:\/|$)/u.test(path) ||
          (path === "/summary" && Boolean(source.basis.sourceBasis));
        if (target.kind === "script") {
          const match = /^\/content\/blocks\/(0|[1-9][0-9]*)\/text$/u.exec(
            path,
          );
          const block = match
            ? source.basis.productionSourceBasis?.document?.blocks[
                Number(match[1])
              ]
            : undefined;
          allowed = Boolean(block && block.type !== "page_break");
        } else if (target.kind === "scene")
          allowed = [
            "/content/场景动作",
            "/content/对白与备注",
            "/content/地点与时间",
          ].includes(path);
        if (allowed && value.trim())
          result.push({
            sourceId: reference.sourceId,
            sourceVersion: reference.sourceVersion,
            fieldPath: reference.fieldPath,
            valuePath: path,
            text: value,
          });
        return;
      }
      if (Array.isArray(value))
        value.forEach((item, index) => walk(item, `${path}/${index}`));
      else if (value && typeof value === "object")
        for (const [key, item] of Object.entries(value))
          walk(item, `${path}/${escape(key)}`);
    };
    walk(reference.value, "");
  }
  return result;
}
export function localHumanContent(
  source: NarrativeLocalQualitySource,
  summary: string,
  drafts: LocalIssueDraft[],
) {
  const fields = localEvidenceFields(source),
    request = source.basis.request;
  const issues = drafts.map((draft) => {
    const field = fields.find((item) => localFieldKey(item) === draft.field),
      quote = draft.quote.trim();
    if (!field || !quote || !field.text.includes(quote))
      throw new Error(
        "每条人工问题须明确选择实际目标字段和逐字引文，不自动截取或换源。",
      );
    const { text: _text, ...evidence } = field;
    return {
      id: draft.id,
      category: draft.category,
      severity: draft.severity,
      source: "human" as const,
      message: draft.message,
      suggestion: draft.suggestion,
      evidence: [{ ...evidence, quote }],
    };
  });
  return NarrativeLocalHumanContentSchema.parse({
    summary,
    reviewedDimensions: request.dimensions,
    issues,
    ...(request.target.kind === "chapter-set"
      ? { reviewedChapters: request.chapterScope!.chapters }
      : {}),
    ...(source.basis.sourceBasis || source.basis.productionSourceBasis
      ? {
          reviewedSources: localTargetReferences(source).map(
            ({ sourceId, sourceVersion, fieldPath }) => ({
              sourceId,
              sourceVersion,
              fieldPath,
            }),
          ),
        }
      : {}),
  });
}
