import type {
  AssetCenterAsset,
  DomainEntity,
} from "@dramaip/contracts/product";

export type StoryboardStillState = "adopted" | "candidate" | "missing";

export type StoryboardShot = {
  readonly id: string;
  readonly sceneId: string;
  readonly title: string;
  readonly version: number;
  readonly order: number;
  readonly visualDescription: string;
  readonly dialogue: string;
  readonly camera: string;
  readonly movement: string;
  readonly duration: string;
  readonly taskStatus: string;
  readonly stillState: StoryboardStillState;
  readonly referencedAssets: AssetCenterAsset[];
  readonly categoryCounts: Record<AssetCenterAsset["category"], number>;
  readonly missingAssetReference: boolean;
  readonly rightsBlocked: boolean;
  readonly costRisk: boolean;
  readonly lockedAssetCount: number;
};

export type StoryboardScene = {
  readonly id: string;
  readonly scriptId: string;
  readonly title: string;
  readonly location: string;
  readonly shots: StoryboardShot[];
};

function payload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function orderOf(entity: DomainEntity): number {
  const values = payload(entity.payload);
  return (
    positiveNumber(values["排序"]) ??
    positiveNumber(values["镜头序号"]) ??
    Number.MAX_SAFE_INTEGER
  );
}

export function orderStoryboardEntities(
  records: readonly DomainEntity[],
): DomainEntity[] {
  return [...records].sort(
    (left, right) =>
      orderOf(left) - orderOf(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function assetReferences(source: Record<string, unknown>): string[] {
  return Array.isArray(source["资产版本引用"])
    ? source["资产版本引用"].filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

function stillStateFor(
  shotId: string,
  stills: readonly DomainEntity[],
): StoryboardStillState {
  const matches = stills.filter((still) => still.parentId === shotId);
  if (matches.some((still) => payload(still.payload)["采用状态"] === "已采用"))
    return "adopted";
  return matches.length ? "candidate" : "missing";
}

/**
 * Derives the storyboard from authoritative production entities.  It never
 * creates a second shot order or a parallel asset assignment store.
 */
export function buildStoryboard(input: {
  episodeId?: string;
  scripts: readonly DomainEntity[];
  scenes: readonly DomainEntity[];
  shots: readonly DomainEntity[];
  stills: readonly DomainEntity[];
  assets: readonly AssetCenterAsset[];
}): StoryboardScene[] {
  const scriptIds = new Set(
    input.scripts
      .filter(
        (script) => !input.episodeId || script.parentId === input.episodeId,
      )
      .map((script) => script.id),
  );
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  return orderStoryboardEntities(
    input.scenes.filter((scene) => scriptIds.has(scene.parentId ?? "")),
  ).map((scene) => {
    const scenePayload = payload(scene.payload);
    const sceneShots = orderStoryboardEntities(
      input.shots.filter((shot) => shot.parentId === scene.id),
    ).map((shot, index) => {
      const shotPayload = payload(shot.payload);
      const referencedAssets = assetReferences(shotPayload)
        .map((assetId) => assetById.get(assetId))
        .filter((asset): asset is AssetCenterAsset => Boolean(asset));
      const categoryCounts: StoryboardShot["categoryCounts"] = {
        character: 0,
        scene: 0,
        prop: 0,
        voice: 0,
      };
      for (const asset of referencedAssets) categoryCounts[asset.category] += 1;
      return {
        id: shot.id,
        sceneId: scene.id,
        title: shot.title,
        version: shot.version,
        order: positiveNumber(shotPayload["排序"]) ?? index + 1,
        visualDescription:
          text(shotPayload["镜头描述"]) || "尚未填写镜头画面说明。",
        dialogue: text(shotPayload["对白"]) || text(shotPayload["对白与备注"]),
        camera: text(shotPayload["景别"]) || text(shotPayload["机位"]),
        movement: text(shotPayload["运镜"]) || text(shotPayload["镜头运动"]),
        duration: text(shotPayload["时长"]) || text(shotPayload["时长秒"]),
        taskStatus: text(shotPayload["任务状态"]) || "未安排镜头任务",
        stillState: stillStateFor(shot.id, input.stills),
        referencedAssets,
        categoryCounts,
        missingAssetReference: assetReferences(shotPayload).length === 0,
        rightsBlocked: referencedAssets.some(
          (asset) => asset.rightsStatus === "restricted" || asset.stale,
        ),
        costRisk: referencedAssets.some(
          (asset) =>
            asset.costStatus === "unknown" ||
            asset.providerStatus === "unavailable",
        ),
        lockedAssetCount: referencedAssets.filter(
          (asset) => asset.lockStatus === "locked",
        ).length,
      };
    });
    return {
      id: scene.id,
      scriptId: scene.parentId ?? "",
      title: scene.title,
      location: text(scenePayload["地点与时间"]),
      shots: sceneShots,
    };
  });
}

export function reorderStoryboardShots(
  shots: readonly StoryboardShot[],
  movingId: string,
  targetId: string,
): StoryboardShot[] {
  const from = shots.findIndex((shot) => shot.id === movingId);
  const to = shots.findIndex((shot) => shot.id === targetId);
  if (from < 0 || to < 0 || from === to) return [...shots];
  const next = [...shots];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving!);
  return next;
}
