import { createHash } from "node:crypto";
import {
  EpisodeOutlineContentSchema,
  type EpisodeDevelopmentBasis,
} from "@dramaip/contracts/production";

/** Shared structural/source identity rules, not a narrative quality certificate. */
export function inspectEpisodeOutlineContent(
  value: unknown,
  basis: EpisodeDevelopmentBasis,
) {
  const content = EpisodeOutlineContentSchema.parse(value);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const ids = content.scenes.map((item) => item.id);
  const beats = content.scenes.flatMap((item) =>
    item.beats.map((beat) => beat.id),
  );
  if (
    new Set(ids).size !== ids.length ||
    new Set(beats).size !== beats.length ||
    content.scenes.some((scene, index) => scene.orderIndex !== index)
  )
    fail("场景/节拍标识重复或场景顺序不完整。");
  if (
    content.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) !==
    basis.episode.durationSeconds
  )
    fail("单集场景预计时长总和必须匹配季纲本集目标。");
  const used = new Set<string>(),
    fingerprints = new Set<string>(),
    usedDirect = new Set<string>();
  const directNarrative = basis.request.direct
    ? basis.references.filter(
        (ref) =>
          (ref.sourceKind === "project" &&
            basis.request.direct!.entryPath === "inspiration") ||
          ref.sourceId === basis.request.direct!.sourceScript?.id,
      )
    : [];
  for (const scene of content.scenes) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          scene.goal,
          scene.conflict,
          scene.outcome,
          scene.beats.map((item) => item.action),
        ]),
      )
      .digest("hex");
    if (fingerprints.has(fingerprint))
      fail("不能用改名的相同场景节拍冒充推进。");
    fingerprints.add(fingerprint);
    if (basis.request.direct) {
      if (scene.sourceChapters.length || !scene.sourceReferences?.length)
        fail("直写场景须绑定真实故事来源，不能补造章节或空来源。");
      const seen = new Set<string>();
      for (const ref of scene.sourceReferences ?? []) {
        const key = `${ref.sourceKind}:${ref.sourceId}:${ref.sourceVersion}:${ref.fieldPath}`;
        if (
          seen.has(key) ||
          !directNarrative.some(
            (source) =>
              source.sourceKind === ref.sourceKind &&
              source.sourceId === ref.sourceId &&
              source.sourceVersion === ref.sourceVersion &&
              source.fieldPath === ref.fieldPath,
          )
        )
          fail("直写场景引用未提供、目录元数据、外部或旧版本来源。");
        seen.add(key);
        usedDirect.add(key);
      }
    } else if (!scene.sourceChapters.length || scene.sourceReferences)
      fail("季纲场景须保留实际章节，不混入直写来源。");
    const seen = new Set<string>();
    for (const source of scene.sourceChapters) {
      if (
        seen.has(source.id) ||
        !basis.chapters.some(
          (item) => item.id === source.id && item.version === source.version,
        )
      )
        fail("场景包含重复、未读、外部或旧版本章节。");
      seen.add(source.id);
      used.add(source.id);
    }
  }
  if (
    directNarrative.some(
      (ref) =>
        !usedDirect.has(
          `${ref.sourceKind}:${ref.sourceId}:${ref.sourceVersion}:${ref.fieldPath}`,
        ),
    )
  )
    fail("直写大纲遗漏了明确冻结的故事来源。");
  if (basis.chapters.some((item) => !used.has(item.id)))
    fail("单集大纲遗漏了季纲指定的原文来源。");
  return content;
}
