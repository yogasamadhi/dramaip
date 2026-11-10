import { createHash } from "node:crypto";
import {
  creationReference,
  type CreationContent,
} from "@dramaip/contracts/creation";
import {
  AdaptationStrategyContentSchema,
  type AdaptationDiagnosis,
  type AdaptationStrategyBasis,
  type AdaptationStrategy,
} from "@dramaip/contracts/production";
import { assertReviewedNarrativeSources } from "./narrative-sources.js";

export const strategyHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function strategyDiagnosisReference(diagnosis: AdaptationDiagnosis) {
  const { strategies: _legacyProposals, ...narrative } = diagnosis.content;
  return creationReference("adaptation-diagnosis", {
    id: diagnosis.id,
    version: diagnosis.version,
    projectId: diagnosis.projectId,
    title: "已采用诊断的叙事判断与证据（不代替独立策略）",
    content: narrative,
  });
}
export function selectedAdaptationStrategyReference(value: AdaptationStrategy) {
  const option = value.content.options.find(
    (item) => item.id === value.selectedOptionId,
  );
  if (!option || value.status !== "adopted")
    throw new Error("独立策略尚未明确采用一个选项。");
  return creationReference("adaptation-strategy", {
    id: value.id,
    version: value.version,
    projectId: value.projectId,
    title: "已明确采用的唯一独立改编策略",
    content: { summary: value.content.summary, option },
  });
}
export function inspectAdaptationStrategy(
  output: CreationContent,
  basis: AdaptationStrategyBasis,
  diagnosis: { content: { findings: Array<{ id: string }> } },
) {
  if (
    output.items.length !== 1 ||
    output.items[0]?.kind !== "adaptation-strategy" ||
    output.items[0].parentRef ||
    !output.content.trim()
  )
    throw new Error(
      "独立策略必须仅有一个结构化策略集合和非空摘要，不包含其他作品正文。",
    );
  const content = AdaptationStrategyContentSchema.parse(output.items[0].data);
  const findingIds = new Set(diagnosis.content.findings.map((item) => item.id));
  const ids = new Set<string>();
  const actions = new Set<string>();
  for (const option of content.options) {
    if (ids.has(option.id)) throw new Error("策略选项标识重复。");
    ids.add(option.id);
    if (
      new Set(option.findingIds).size !== option.findingIds.length ||
      option.findingIds.some((id) => !findingIds.has(id))
    )
      throw new Error("策略必须引用冻结诊断中真实且不重复的发现标识。");
    const action = strategyHash(
      [
        option.preserve,
        option.merge,
        option.remove,
        option.reorder,
        option.restructure,
      ].map((values) =>
        [...values].map((value) => value.replace(/\s+/gu, " ").trim()).sort(),
      ),
    );
    if (actions.has(action))
      throw new Error(
        "策略不能只更换标题或说明；保留／合并／删减／重排／重构动作必须有实际差别。",
      );
    actions.add(action);
  }
  if (basis.sourceBasis)
    assertReviewedNarrativeSources(basis.sourceBasis, content.reviewedSources);
  else if (content.reviewedSources)
    throw new Error("完整原文兼容范围不能伪造混合来源声明。");
  return content;
}
