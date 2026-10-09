import { createHash } from "node:crypto";
import {
  NarrativeLocalHumanContentSchema,
  NarrativeLocalRuleContentSchema,
  type NarrativeLocalQualitySource,
} from "@dramaip/contracts/creative-quality";
import { inspectNarrativeContent } from "./narrative-content.js";

export function canonicalLocalQualityJSON(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return item;
  };
  const result = JSON.stringify(canonical(value));
  if (result === undefined)
    throw new Error("本地评议哈希必须来自实际 JSON 值。");
  return result;
}
export const localQualityDigest = (value: unknown) =>
  createHash("sha256").update(canonicalLocalQualityJSON(value)).digest("hex");

export function inspectLocalHumanContent(
  raw: unknown,
  source: NarrativeLocalQualitySource,
) {
  const content = NarrativeLocalHumanContentSchema.parse(raw);
  return inspectNarrativeContent(
    content,
    { ...source.basis, baseReportId: null },
    source.references,
    "human",
  );
}

/** Exact repeated passages only. This rule never provides semantic dimension coverage. */
export function inspectLocalLiteralRepetition(
  source: NarrativeLocalQualitySource,
) {
  const target = source.basis.request.target;
  const refs = source.references.filter((reference) =>
    target.kind === "chapter-set"
      ? source.basis.sourceBasis
        ? source.basis.sourceBasis.references.some(
            (item) =>
              item.sourceId === reference.sourceId &&
              item.sourceVersion === reference.sourceVersion &&
              item.fieldPath === reference.fieldPath,
          )
        : source.basis.request.chapterScope?.chapters.some(
            (chapter) =>
              chapter.id === reference.sourceId &&
              chapter.version === reference.sourceVersion,
          )
      : reference.sourceId === target.id &&
        reference.sourceVersion === target.version,
  );
  type Evidence = {
    sourceId: string;
    sourceVersion: number;
    fieldPath: string;
    valuePath: string;
    quote: string;
  };
  const passages = new Map<string, Evidence[]>();
  const escape = (key: string) =>
    key.replace(/~/gu, "~0").replace(/\//gu, "~1");
  for (const reference of refs) {
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        let allowed =
          /^\/(?:content|payload)(?:\/|$)/u.test(path) ||
          (path === "/summary" && Boolean(source.basis.sourceBasis));
        if (target.kind === "script") {
          const match = /^\/content\/blocks\/(0|[1-9][0-9]*)\/text$/u.exec(
            path,
          );
          allowed = Boolean(
            match &&
            source.basis.productionSourceBasis?.document?.blocks[
              Number(match[1])
            ]?.type !== "page_break",
          );
        } else if (target.kind === "scene")
          allowed = [
            "/content/场景动作",
            "/content/对白与备注",
            "/content/地点与时间",
          ].includes(path);
        if (!allowed) return;
        for (const paragraph of value
          .split(/\n\s*\n/u)
          .map((item) => item.trim())) {
          if (paragraph.length < 40 || paragraph.length > 2000) continue;
          const entry = {
            sourceId: reference.sourceId,
            sourceVersion: reference.sourceVersion,
            fieldPath: reference.fieldPath,
            valuePath: path,
            quote: paragraph,
          };
          const previous = passages.get(paragraph) ?? [];
          previous.push(entry);
          passages.set(paragraph, previous);
        }
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
  const findings = [...passages]
    .filter(([, entries]) => entries.length > 1)
    .slice(0, 100)
    .map(([quote, evidence]) => ({
      id: `literal-${localQualityDigest(quote).slice(0, 24)}`,
      ruleId: "literal-repeated-passage-v1" as const,
      category: "repetition" as const,
      severity: "suggestion" as const,
      source: "rule" as const,
      message: `明确来源中有 ${evidence.length} 处相同完整段落；只是字面匹配，不判断是否有叙事必要。`,
      suggestion: "由作者核对是否为有意重复；不自动改文或判定文学质量。",
      evidence: evidence.slice(0, 12),
    }));
  return NarrativeLocalRuleContentSchema.parse({
    summary:
      "本机只匹配实际目标表达中40–2000字符的相同完整段落，最多列100条提示、每条12处引用；更长／更短段落不截断成假证据。未检查任何语义维度，无提示不代表质量通过。",
    checkedRules: ["literal-repeated-passage-v1"],
    semanticCoverage: "not-assessed",
    findings,
  });
}
