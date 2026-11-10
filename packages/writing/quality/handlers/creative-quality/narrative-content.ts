import {
  NarrativeQualityContentSchema,
  NarrativeQualityProductionBasisSchema,
  type NarrativeQualityBasis,
  type NarrativeQualityContent,
} from "@dramaip/contracts/creative-quality";
import { ScreenplaySourceDocumentSchema } from "@dramaip/contracts/production";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";

export function narrativeValueAt(value: unknown, pointer: string): unknown {
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(encoded)) return undefined;
    const key = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Structural/evidence validity only, never a claim of semantic correctness. */
export function inspectNarrativeContent(
  raw: unknown,
  basis: NarrativeQualityBasis,
  references: AgentContextReference[],
  expectedSource: "model" | "human" = "model",
): NarrativeQualityContent {
  const content = NarrativeQualityContentSchema.parse(raw);
  const requested = basis.request.dimensions;
  const chapterScope = basis.request.chapterScope;
  const sourceBasis = basis.sourceBasis;
  const productionTarget =
    basis.request.target.kind === "script" ||
    basis.request.target.kind === "scene";
  if (Boolean(basis.request.context) !== Boolean(sourceBasis))
    throw new Error("明确质量表达必须有对应冻结来源，不能用旧原文声明替代。");
  if (basis.request.target.kind === "chapter-set") {
    const coverage = basis.chapterCoverage;
    if (
      !chapterScope ||
      !coverage ||
      coverage.mode !== chapterScope.mode ||
      coverage.included.length !== chapterScope.chapters.length ||
      coverage.included.some(
        (chapter, index) =>
          chapter.id !== chapterScope.chapters[index]?.id ||
          chapter.version !== chapterScope.chapters[index]?.version,
      ) ||
      coverage.totalChapterCount !==
        coverage.included.length + coverage.excluded.length ||
      coverage.nonEmptyChapterCount !==
        coverage.included.length +
          coverage.excluded.filter(
            (chapter) => chapter.reason === "not-selected",
          ).length ||
      new Set(
        [...coverage.included, ...coverage.excluded].map(
          (chapter) => chapter.id,
        ),
      ).size !== coverage.totalChapterCount ||
      (coverage.mode === "full" &&
        coverage.excluded.some((chapter) => chapter.reason !== "empty")) ||
      (!sourceBasis &&
        chapterScope.chapters.some(
          (chapter) =>
            !references.some(
              (entry) =>
                entry.sourceKind === "chapter" &&
                entry.sourceId === chapter.id &&
                entry.sourceVersion === chapter.version &&
                entry.fieldPath === `/chapters/${chapter.id}` &&
                typeof (entry.value as { content?: unknown })?.content ===
                  "string",
            ),
        ))
    )
      throw new Error(
        "跨章覆盖必须匹配实际完整冻结的所选正文、目录和未读原因，不能凭模型声明补足漏读。",
      );
    if (sourceBasis) {
      const covered = new Set([
        ...sourceBasis.chapters.map((chapter) => chapter.id),
        ...(sourceBasis.summaries ?? []).flatMap((summary) =>
          summary.chapters.map((chapter) => chapter.id),
        ),
      ]);
      const request = basis.request.context!;
      const expressionIdentity = (value: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }) =>
        JSON.stringify([value.sourceId, value.sourceVersion, value.fieldPath]);
      const expected = sourceBasis.references.map(expressionIdentity);
      const actual = content.reviewedSources?.map(expressionIdentity);
      if (
        sourceBasis.projectId !== basis.request.target.id ||
        sourceBasis.omitted.length ||
        covered.size !== chapterScope.chapters.length ||
        chapterScope.chapters.some((chapter) => !covered.has(chapter.id)) ||
        sourceBasis.chapters.length !== request.chapters.length ||
        sourceBasis.chapters.some((chapter, index) => {
          const { contentHash: _hash, ...selection } = chapter;
          return (
            JSON.stringify(selection) !==
            JSON.stringify(request.chapters[index])
          );
        }) ||
        (sourceBasis.summaries?.length ?? 0) !==
          (request.summaries?.length ?? 0) ||
        sourceBasis.summaries?.some(
          (summary, index) =>
            summary.id !== request.summaries?.[index]?.id ||
            summary.version !== request.summaries?.[index]?.version,
        ) ||
        !actual ||
        actual.length !== expected.length ||
        new Set(actual).size !== actual.length ||
        expected.some((identity) => !actual.includes(identity)) ||
        sourceBasis.references.some(
          (source) =>
            !references.some(
              (entry) =>
                entry.sourceKind === source.sourceKind &&
                expressionIdentity(entry) === expressionIdentity(source),
            ),
        ) ||
        coverage.included.some((chapter) => {
          const representations = [
            ...sourceBasis.chapters
              .filter((value) => value.id === chapter.id)
              .map((value) => value.representation),
            ...(sourceBasis.summaries?.some((summary) =>
              summary.chapters.some((value) => value.id === chapter.id),
            )
              ? ["hierarchical-summary"]
              : []),
          ];
          return (
            JSON.stringify(chapter.representations) !==
            JSON.stringify(representations)
          );
        })
      )
        throw new Error(
          "混合评议必须精确声明全部实际冻结表达和覆盖版本；摘要/段落不能冒充完整原文或漏读后补声明。",
        );
    } else if (
      content.reviewedSources ||
      coverage.included.some((chapter) => chapter.representations)
    )
      throw new Error("原文报告不能附加未确认的混合表达声明。");
    const reviewed = content.reviewedChapters;
    if (
      !chapterScope ||
      !reviewed ||
      new Set(reviewed.map((chapter) => chapter.id)).size !== reviewed.length ||
      reviewed.length !== chapterScope.chapters.length ||
      chapterScope.chapters.some(
        (chapter) =>
          !reviewed.some(
            (value) =>
              value.id === chapter.id && value.version === chapter.version,
          ),
      )
    )
      throw new Error(
        "跨章报告必须列明本轮全部已读章节版本，局部/漏读不能冒充全书。此声明不保证模型语义正确。",
      );
  } else if (productionTarget) {
    const target = basis.request.target;
    const saved = NarrativeQualityProductionBasisSchema.parse(
      basis.productionSourceBasis,
    );
    const targetReferences = references.filter(
      (reference) =>
        reference.sourceKind === "production" &&
        reference.sourceId === target.id &&
        reference.sourceVersion === target.version &&
        reference.fieldPath === `/production/${target.id}`,
    );
    const reference = targetReferences[0];
    const value = reference?.value as
      | {
          projectId?: unknown;
          kind?: unknown;
          sourceFingerprint?: unknown;
          content?: unknown;
        }
      | undefined;
    if (
      chapterScope ||
      basis.chapterCoverage ||
      sourceBasis ||
      content.reviewedChapters ||
      targetReferences.length !== 1 ||
      saved.id !== target.id ||
      saved.kind !== target.kind ||
      saved.version !== target.version ||
      saved.contentHash !== target.sourceFingerprint ||
      value?.projectId !== saved.projectId ||
      value.kind !== saved.kind ||
      value.sourceFingerprint !== saved.contentHash ||
      content.reviewedSources?.length !== 1 ||
      content.reviewedSources[0]?.sourceId !== reference?.sourceId ||
      content.reviewedSources[0]?.sourceVersion !== reference?.sourceVersion ||
      content.reviewedSources[0]?.fieldPath !== reference?.fieldPath
    )
      throw new Error(
        "普通报告必须明确声明实际保存目标的完整冻结表达与指纹，不附加小说范围或补用最新稿。",
      );
    if (saved.kind === "script") {
      const document = ScreenplaySourceDocumentSchema.parse(value.content);
      if (
        document.id !== saved.document?.id ||
        document.version !== saved.document.version ||
        document.blocks.length !== saved.document.blocks.length ||
        document.blocks.some(
          (block, index) =>
            block.id !== saved.document?.blocks[index]?.id ||
            block.type !== saved.document.blocks[index]?.type,
        )
      )
        throw new Error(
          "剧本报告保存文档／块身份、版本与顺序必须匹配实际冻结来源。",
        );
    }
  } else if (
    content.reviewedChapters ||
    content.reviewedSources ||
    basis.chapterCoverage ||
    sourceBasis
  )
    throw new Error("单对象报告不能附加未确认的跨章覆盖声明。");
  if (!productionTarget && basis.productionSourceBasis)
    throw new Error("历史质量目标不能附加未确认的普通剧本／场景基准。");
  if (
    new Set(requested).size !== requested.length ||
    new Set(content.reviewedDimensions).size !==
      content.reviewedDimensions.length ||
    content.reviewedDimensions.length !== requested.length ||
    requested.some(
      (dimension) => !content.reviewedDimensions.includes(dimension),
    )
  )
    throw new Error(
      "质量报告必须逐项覆盖且仅覆盖所选检查维度，不得重复或漏项。",
    );
  if (
    new Set(content.issues.map((issue) => issue.id)).size !==
    content.issues.length
  )
    throw new Error("质量问题标识重复，无法安全追踪人工处理。");
  for (const issue of content.issues) {
    if (issue.source !== expectedSource || !requested.includes(issue.category))
      throw new Error(
        expectedSource === "model"
          ? "AI 质量意见只能标为 model，且问题类别必须属于所选范围。"
          : "人工声明只能标为 human，且问题类别必须属于明确评议范围。",
      );
    if (
      !issue.evidence.some((entry) =>
        basis.request.target.kind === "chapter-set"
          ? sourceBasis
            ? sourceBasis.references.some(
                (source) =>
                  source.sourceId === entry.sourceId &&
                  source.sourceVersion === entry.sourceVersion &&
                  source.fieldPath === entry.fieldPath,
              )
            : chapterScope?.chapters.some(
                (chapter) =>
                  chapter.id === entry.sourceId &&
                  chapter.version === entry.sourceVersion,
              )
          : entry.sourceId === basis.request.target.id &&
            entry.sourceVersion === basis.request.target.version &&
            (!productionTarget ||
              entry.fieldPath === `/production/${basis.request.target.id}`),
      )
    )
      throw new Error("每条问题必须有本次目标版本的证据，不能只批评旁证资料。");
    for (const evidence of issue.evidence) {
      const source = references.find(
        (entry) =>
          entry.sourceId === evidence.sourceId &&
          entry.sourceVersion === evidence.sourceVersion &&
          entry.fieldPath === evidence.fieldPath,
      );
      const text = source
        ? narrativeValueAt(source.value, evidence.valuePath)
        : undefined;
      let textField =
        /^\/(?:content|payload)(?:\/|$)/u.test(evidence.valuePath) ||
        (Boolean(sourceBasis) &&
          evidence.valuePath === "/summary" &&
          source?.sourceKind === "knowledge" &&
          ["summary", "hierarchical-summary"].includes(
            (source.value as { representation: string }).representation,
          ));
      if (productionTarget && source?.sourceId === basis.request.target.id) {
        if (basis.request.target.kind === "script") {
          const match = /^\/content\/blocks\/(0|[1-9][0-9]*)\/text$/u.exec(
            evidence.valuePath,
          );
          const block = match
            ? basis.productionSourceBasis?.document?.blocks[Number(match[1])]
            : undefined;
          textField = Boolean(block && block.type !== "page_break");
        } else
          textField = [
            "/content/场景动作",
            "/content/对白与备注",
            "/content/地点与时间",
          ].includes(evidence.valuePath);
      }
      if (
        !textField ||
        typeof text !== "string" ||
        !text.includes(evidence.quote)
      )
        throw new Error(
          "质量证据必须逐字来自本轮完整冻结的实际字段，不允许虚构位置、外部引用或旧版本。",
        );
    }
  }
  return content;
}
