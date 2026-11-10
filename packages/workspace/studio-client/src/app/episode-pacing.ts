import type { DomainEntity } from "@dramaip/contracts/product";

export type PacingKind = "density" | "highlight" | "reversal" | "cliffhanger";
export type PacingDisposition = "active" | "rejected";
export type PacingSourceDomain =
  "episode" | "script" | "beat" | "scene" | "shot";

export type PacingPoint = {
  id: string;
  kind: PacingKind;
  position: number;
  title: string;
  evidence: string;
  confidence: "derived" | "manual";
  disposition: PacingDisposition;
  sourceId?: string;
  sourceVersion?: number;
  sourceDomain?: PacingSourceDomain;
  scriptId?: string;
  stale: boolean;
};

export type EpisodePacingBoard = {
  episodeId: string;
  points: PacingPoint[];
  hasSources: boolean;
  staleCount: number;
  rejectedCount: number;
};

type TimelineSource = {
  entity: DomainEntity;
  domain: PacingSourceDomain;
  position: number;
  scriptId?: string;
};

const payload = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const order = (entity: DomainEntity): number => {
  const value =
    payload(entity.payload)["排序"] ??
    payload(entity.payload)["镜头序号"] ??
    payload(entity.payload)["场景序号"];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.MAX_SAFE_INTEGER;
};

const ordered = (entities: DomainEntity[]) =>
  [...entities].sort(
    (left, right) =>
      order(left) - order(right) ||
      left.createdAt.localeCompare(right.createdAt),
  );

const sourceEvidence = (source: TimelineSource): string => {
  const values = payload(source.entity.payload);
  if (source.domain === "episode")
    return [text(values["分集简介"]), text(values["结尾悬念"])]
      .filter(Boolean)
      .join("\n");
  if (source.domain === "script")
    return [text(values["剧本内容"]), text(values["审查意见"])]
      .filter(Boolean)
      .join("\n");
  if (source.domain === "beat")
    return [
      text(values["节拍描述"]),
      text(values["高光"]),
      text(values["反转"]),
      text(values["结尾悬念"]),
    ]
      .filter(Boolean)
      .join("\n");
  return [
    text(values["场景动作"] ?? values["镜头描述"]),
    text(values["对白与备注"] ?? values["对白"]),
    text(values["审查备注"]),
  ]
    .filter(Boolean)
    .join("\n");
};

function buildTimeline(input: {
  episode?: DomainEntity;
  scripts: DomainEntity[];
  beats: DomainEntity[];
  scenes: DomainEntity[];
  shots: DomainEntity[];
}): TimelineSource[] {
  const sources: Omit<TimelineSource, "position">[] = [];
  if (input.episode) sources.push({ entity: input.episode, domain: "episode" });
  const beatByParent = new Map<string, DomainEntity[]>();
  for (const beat of input.beats) {
    const parent = beat.parentId ?? "";
    beatByParent.set(parent, [...(beatByParent.get(parent) ?? []), beat]);
  }
  const sceneByScript = new Map<string, DomainEntity[]>();
  for (const scene of input.scenes) {
    const parent = scene.parentId ?? "";
    sceneByScript.set(parent, [...(sceneByScript.get(parent) ?? []), scene]);
  }
  const shotByScene = new Map<string, DomainEntity[]>();
  for (const shot of input.shots) {
    const parent = shot.parentId ?? "";
    shotByScene.set(parent, [...(shotByScene.get(parent) ?? []), shot]);
  }
  for (const beat of ordered(beatByParent.get(input.episode?.id ?? "") ?? []))
    sources.push({ entity: beat, domain: "beat" });
  for (const script of ordered(input.scripts)) {
    sources.push({ entity: script, domain: "script", scriptId: script.id });
    for (const beat of ordered(beatByParent.get(script.id) ?? []))
      sources.push({ entity: beat, domain: "beat", scriptId: script.id });
    for (const scene of ordered(sceneByScript.get(script.id) ?? [])) {
      sources.push({ entity: scene, domain: "scene", scriptId: script.id });
      for (const shot of ordered(shotByScene.get(scene.id) ?? []))
        sources.push({ entity: shot, domain: "shot", scriptId: script.id });
    }
  }
  return sources.map((source, index) => ({ ...source, position: index + 1 }));
}

export function buildEpisodePacingBoard(input: {
  episodeId: string;
  episode?: DomainEntity;
  scripts: DomainEntity[];
  beats: DomainEntity[];
  scenes: DomainEntity[];
  shots: DomainEntity[];
  manualMarks: DomainEntity[];
}): EpisodePacingBoard {
  const sources = buildTimeline(input);
  const derived = sources.flatMap((source): PacingPoint[] => {
    const evidence = sourceEvidence(source);
    if (!evidence) return [];
    const point = (kind: PacingKind, fallback: string): PacingPoint => ({
      id: `${kind}:${source.entity.id}`,
      kind,
      position: source.position,
      title: source.entity.title,
      evidence: evidence || fallback,
      confidence: "derived",
      disposition: "active",
      sourceId: source.entity.id,
      sourceVersion: source.entity.version,
      sourceDomain: source.domain,
      ...(source.scriptId ? { scriptId: source.scriptId } : {}),
      stale: false,
    });
    const points = [point("density", "可追溯节拍来源")];
    const hints = `${evidence} ${text(payload(source.entity.payload)["钩子"])} ${text(payload(source.entity.payload)["结尾悬念"])} ${text(payload(source.entity.payload)["反转"])}`;
    if (/反转|却|原来|真相/.test(hints))
      points.push(point("reversal", "来源标注了反转"));
    if (/悬念|危机|未解|不要|谁/.test(hints))
      points.push(point("cliffhanger", "来源标注了悬念"));
    if (/冲突|目标|揭示|决定|发现|高光/.test(hints))
      points.push(point("highlight", "来源标注了爽点"));
    return points;
  });
  const versions = new Map(
    sources.map((source) => [source.entity.id, source.entity.version]),
  );
  const sourceScripts = new Map(
    sources.flatMap((source) =>
      source.scriptId && source.entity.id
        ? [[source.entity.id, source.scriptId] as const]
        : [],
    ),
  );
  const manual = input.manualMarks.flatMap((entity): PacingPoint[] => {
    const mark = payload(entity.payload);
    const kind = text(mark["类型"]);
    if (
      !(
        ["density", "highlight", "reversal", "cliffhanger"] as string[]
      ).includes(kind)
    )
      return [];
    const sourceId = text(mark["来源标识"]) || undefined;
    const sourceVersion =
      typeof mark["来源版本"] === "number" ? mark["来源版本"] : undefined;
    const rejected = text(mark["状态"]) === "已否决";
    return [
      {
        id: entity.id,
        kind: kind as PacingKind,
        position: typeof mark["位置"] === "number" ? mark["位置"] : 1,
        title: entity.title,
        evidence: text(mark["依据"]) || "人工标注",
        confidence: "manual",
        disposition: rejected ? "rejected" : "active",
        sourceId,
        sourceVersion,
        ...(sourceId && sourceScripts.get(sourceId)
          ? { scriptId: sourceScripts.get(sourceId) }
          : {}),
        stale: Boolean(
          sourceId &&
          sourceVersion !== undefined &&
          versions.get(sourceId) !== sourceVersion,
        ),
      },
    ];
  });
  const points = [...derived, ...manual].sort(
    (left, right) =>
      left.position - right.position || left.kind.localeCompare(right.kind),
  );
  return {
    episodeId: input.episodeId,
    points,
    hasSources: sources.some((source) => Boolean(sourceEvidence(source))),
    staleCount: points.filter((point) => point.stale).length,
    rejectedCount: points.filter((point) => point.disposition === "rejected")
      .length,
  };
}
