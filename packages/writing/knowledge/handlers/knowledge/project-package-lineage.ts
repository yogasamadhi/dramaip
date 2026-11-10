import type { CreativePackageAssets } from "@dramaip/contracts";

/** Output-only guard; records and permitted identity/version lineage are unchanged. */
export function projectPackageLineage(
  assets: CreativePackageAssets,
): CreativePackageAssets {
  const localPath = (value: string) =>
    /^(?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/]|file:\/\/)/iu.test(value);
  const identities = [
    ...assets.causalNodes.flatMap((value) => [
      value.sourceType,
      value.sourceId,
    ]),
    ...assets.audienceStates.map((value) => value.subjectId),
    ...assets.provenance.flatMap((value) => [
      value.fromType,
      value.fromId,
      value.toType,
      value.toId,
    ]),
  ];
  if (identities.some(localPath))
    throw new Error(
      "谱系含不允许导出的本地路径标识，请使用不透明来源引用；原记录未改动。",
    );
  return {
    ...assets,
    provenance: assets.provenance.map((value) => {
      if (value.relation === "quoted_from") return { ...value };
      const { quoteExcerpt: _notAQuote, ...metadata } = value;
      return metadata;
    }),
  };
}
