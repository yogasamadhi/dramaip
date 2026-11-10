import {
  ProductionQualitySourceSchema,
  type ProductionQualitySource,
} from "@dramaip/contracts/production";
import { creationReference } from "@dramaip/contracts/creation";
import {
  NarrativeQualityProductionBasisSchema,
  type NarrativeQualityRequest,
} from "@dramaip/contracts/creative-quality";

/** Exact saved expression only. Parent text and legacy serialized script are not model input. */
export function freezeProductionQualitySource(
  projectId: string,
  target: NarrativeQualityRequest["target"],
  raw: ProductionQualitySource,
) {
  const source = ProductionQualitySourceSchema.parse(raw);
  if (
    source.projectId !== projectId ||
    source.id !== target.id ||
    source.kind !== target.kind ||
    source.version !== target.version ||
    source.source.state !== "available" ||
    source.source.contentHash !== target.sourceFingerprint
  )
    throw new Error(
      "请重新明确确认实际保存剧本／场景的版本与来源指纹；不可核对来源不补成最新稿。",
    );
  const saved = source.source;
  const document = saved.document;
  const content =
    document ??
    Object.fromEntries(
      ["场景动作", "对白与备注", "地点与时间"].flatMap((key) =>
        typeof saved.record.payload[key] === "string"
          ? [[key, saved.record.payload[key]]]
          : [],
      ),
    );
  const reference = {
    ...creationReference("production", {
      id: source.id,
      version: source.version,
      projectId,
      title: source.title,
      kind: source.kind,
      sourceFingerprint: saved.contentHash,
      content,
    }),
    policyDependencies: saved.policyDependencies,
  };
  const productionSourceBasis = NarrativeQualityProductionBasisSchema.parse({
    projectId,
    id: source.id,
    kind: source.kind,
    version: source.version,
    contentHash: saved.contentHash,
    recordContentHash: saved.recordContentHash,
    ...(document
      ? {
          document: {
            id: document.id,
            version: document.version,
            contentHash: saved.documentContentHash,
            blocks: document.blocks.map((block, index) => ({
              id: block.id,
              index,
              type: block.type,
            })),
          },
        }
      : {}),
    ancestors: saved.ancestors,
  });
  return { reference, productionSourceBasis };
}
