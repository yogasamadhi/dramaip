import type { StudioClient } from "@dramaip/client";
import { MediaRecordSchema } from "@dramaip/contracts/media";

const names = [
  "mediaSourceReviewId",
  "audioRevisionId",
  "audioResolutionId",
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function mediaReviewRequest(search: string) {
  const params = new URLSearchParams(search);
  const present = names.filter((name) => params.has(name));
  if (!present.length) return undefined;
  if (present.length !== 1)
    throw new Error("只能返回一种明确的媒体待确认对象。");
  const kind = present[0]!;
  const projectId = params.get("projectId") ?? "";
  const id = params.get(kind) ?? "";
  if (
    !uuid.test(id) ||
    !uuid.test(projectId) ||
    params.getAll(kind).length !== 1 ||
    params.getAll("projectId").length !== 1
  )
    throw new Error("待确认入口缺少有效且唯一的项目／对象身份。");
  const expected = new Map<string, string>();
  for (const name of ["recordId", "sourceTrackId", "episodeId", "timelineId"]) {
    if (!params.has(name)) continue;
    const value = params.get(name)!;
    if (!uuid.test(value) || params.getAll(name).length !== 1)
      throw new Error("关联对象身份无效或重复。");
    expected.set(name, value);
  }
  return { kind, id, projectId, expected };
}

/** Exact owner reads only. In particular, never call timeline.get(episodeId), which may initialize a timeline. */
export async function readMediaReviewReturn(
  client: StudioClient,
  search: string,
) {
  const request = mediaReviewRequest(search);
  if (!request) throw new Error("没有指定媒体待确认对象。");
  if (
    !(await client.projects.list()).some(
      (project) => project.id === request.projectId,
    )
  )
    throw new Error("指定项目已不存在；不会替换为其他项目。");
  const matches = (values: Record<string, string | undefined>) => {
    if (
      values.projectId !== request.projectId ||
      [...request.expected].some(([name, value]) => values[name] !== value)
    )
      throw new Error(
        "指定对象不属于入口中的项目或关联身份；不会切换到其他对象。",
      );
  };
  if (request.kind === "mediaSourceReviewId") {
    const review = await client.mediaSources.get(request.id);
    matches({ projectId: review.projectId, recordId: review.recordId });
    const record = MediaRecordSchema.parse(
      await client.mediaSources.record(review.recordId),
    );
    const shot = await client.resources.get("shots", review.shotId);
    if (
      record.projectId !== request.projectId ||
      shot.projectId !== request.projectId
    )
      throw new Error("实际素材或镜头已不属于指定项目。");
    return { kind: "source" as const, review, record };
  }
  if (request.kind === "audioRevisionId") {
    const review = await client.audioRevisions.get(request.id);
    matches({
      projectId: review.projectId,
      episodeId: review.episodeId,
      sourceTrackId: review.sourceTrackId,
    });
    const tracks = await client.episodeMedia.listAudioTracks(review.episodeId);
    const track = tracks.find(
      (value) =>
        value.id === review.sourceTrackId &&
        value.projectId === request.projectId &&
        value.episodeId === review.episodeId,
    );
    if (!track)
      throw new Error("指定修订的实际原音轨不可用；不会替换为最新音轨。");
    const target = tracks.find(
      (value) =>
        value.id === review.targetTrackId &&
        value.projectId === request.projectId &&
        value.episodeId === review.episodeId,
    );
    return { kind: "revision" as const, review, track, target };
  }
  const review = await client.audioResolutions.get(request.id);
  matches({
    projectId: review.projectId,
    episodeId: review.episodeId,
    timelineId: review.timelineId,
  });
  const options = await client.audioResolutions.options(review.timelineId);
  if (
    review.before.projectId !== request.projectId ||
    review.before.episodeId !== review.episodeId ||
    options.timelineId !== review.timelineId
  )
    throw new Error("实际时间线身份与指定预览不一致；不会新建或切换时间线。");
  return { kind: "resolution" as const, review };
}
