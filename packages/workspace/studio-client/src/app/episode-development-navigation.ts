import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { PilotPackagePreview } from "@dramaip/contracts/delivery";
import { z } from "zod";
import {
  EpisodeDevelopmentOperationSchema,
  type EpisodeDevelopmentResult,
  type EpisodeDevelopmentRequest,
} from "@dramaip/contracts/production";
import { exactObjectReferenceKey } from "./exact-object-navigation";
import { matchesExactEpisodeResult } from "./formal-source-navigation";

// Episode and operation are part of this workbench's local editing scope,
// unlike ordinary directory controls on other exact-object pages.
export function episodeDevelopmentReferenceKey(search: string): string {
  const params = new URLSearchParams(search);
  return JSON.stringify([
    exactObjectReferenceKey(search),
    ...["episodeId", "operation", "sourceRevisionId"].map((key) => [
      key,
      params.getAll(key),
    ]),
  ]);
}

export function episodeDevelopmentNavigationError(
  params: URLSearchParams,
): string | undefined {
  for (const key of [
    "episodeId",
    "operation",
    "resultId",
    "workflowId",
    "shotAttributionId",
    "sourceRevisionId",
    "pilotPackageId",
  ]) {
    const values = params.getAll(key);
    if (values.length > 1 || values.some((value) => !value.trim()))
      return "指定单集链接含空白或重复身份；未选择其他分集或最近运行。";
  }
  if (
    params.has("operation") &&
    !EpisodeDevelopmentOperationSchema.safeParse(params.get("operation"))
      .success
  )
    return "指定单集操作不受支持；未切换为其他操作。";
  if (
    params.has("pilotPackageId") &&
    (!z.string().uuid().safeParse(params.get("pilotPackageId")).success ||
      (params.has("operation") &&
        params.get("operation") !== "storyboard-package") ||
      ["resultId", "workflowId", "shotAttributionId", "sourceRevisionId"].some(
        (key) => params.has(key),
      ))
  )
    return "试制包链接必须精确返回原包，不能混入其他结果或模型运行。";
  if (
    params.has("shotAttributionId") &&
    (!z.string().uuid().safeParse(params.get("shotAttributionId")).success ||
      !params.get("resultId") ||
      (params.has("operation") &&
        params.get("operation") !== "storyboard-package") ||
      params.has("workflowId"))
  )
    return "原镜头关联必须绑定明确正式分镜，不能转到最新成果或模型运行。";
  if (
    params.has("sourceRevisionId") &&
    (!z.string().uuid().safeParse(params.get("sourceRevisionId")).success ||
      !z.string().uuid().safeParse(params.get("resultId")).success ||
      !params.get("episodeId") ||
      params.get("operation") !== "episode-script" ||
      [
        "workflowId",
        "shotAttributionId",
        "topologyRevisionId",
        "scriptRevisionId",
      ].some((key) => params.has(key)))
  )
    return "来源确认必须精确绑定原正式剧本和分集，不能混入其他预览或模型运行。";
  return undefined;
}

export function matchesExactPilotPackage(
  value: Pick<PilotPackagePreview, "id" | "manifest">,
  requested: { previewId: string; projectId: string; episodeId?: string },
): boolean {
  return (
    value.id === requested.previewId &&
    value.manifest.projectId === requested.projectId &&
    (requested.episodeId === undefined ||
      value.manifest.episodeId === requested.episodeId)
  );
}

type QueryRead<T> = {
  data?: T;
  error?: unknown;
  status: string;
  isFetching: boolean;
  isFetchedAfterMount: boolean;
};

// A later background poll can keep the actually-read immutable snapshot in
// view, explicitly labelled as such. A mount-time cache is not an owner read;
// pending/error must never expose it as the requested result.
export function readExactEpisodeResult(
  query: QueryRead<EpisodeDevelopmentResult>,
  requested: Parameters<typeof matchesExactEpisodeResult>[1],
): EpisodeDevelopmentResult | undefined {
  return query.status === "success" &&
    !query.error &&
    query.isFetchedAfterMount &&
    matchesExactEpisodeResult(query.data, requested)
    ? query.data
    : undefined;
}

export type EpisodeWorkflowIdentity = Pick<
  CreationWorkflow,
  "id" | "input" | "episodeDevelopmentBasis"
>;

// HTTP JSON object order is not a different frozen request. Array order,
// optional values and every actual binding are still compared exactly.
function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, orderedJson(item)]),
    );
  return value;
}
export function sameEpisodeDevelopmentRequest(
  a: EpisodeDevelopmentRequest | undefined,
  b: EpisodeDevelopmentRequest | undefined,
): boolean {
  return Boolean(
    a && b && JSON.stringify(orderedJson(a)) === JSON.stringify(orderedJson(b)),
  );
}

// Only an explicit author confirmation may leave an old exact run. A GET,
// poll, cached basis or route restore never rebinds that original run.
export function newEpisodeConfirmationSearch(
  search: string,
  confirmed: { operation: string; request: EpisodeDevelopmentRequest },
  original?: EpisodeWorkflowIdentity,
): string | undefined {
  const params = new URLSearchParams(search);
  if (
    !params.has("workflowId") ||
    (original?.id === params.get("workflowId") &&
      original.input.operation === confirmed.operation &&
      sameEpisodeDevelopmentRequest(
        original.input.episodeDevelopmentRequest,
        confirmed.request,
      ))
  )
    return undefined;
  params.delete("workflowId");
  params.set("operation", confirmed.operation);
  params.set("episodeId", confirmed.request.episodeId);
  return params.toString();
}

export function matchesEpisodeWorkflow(
  value: EpisodeWorkflowIdentity | undefined,
  requested: {
    projectId: string;
    workflowId: string;
    episodeId?: string | null;
    operation?: string | null;
  },
): boolean {
  const request = value?.input.episodeDevelopmentRequest;
  return Boolean(
    value &&
    request &&
    value.id === requested.workflowId &&
    value.input.projectId === requested.projectId &&
    EpisodeDevelopmentOperationSchema.safeParse(value.input.operation)
      .success &&
    (!requested.episodeId || request.episodeId === requested.episodeId) &&
    (!requested.operation || value.input.operation === requested.operation) &&
    // Historical missing basis stays missing; never synthesize a current one.
    (!value.episodeDevelopmentBasis ||
      sameEpisodeDevelopmentRequest(
        value.episodeDevelopmentBasis.request,
        request,
      )),
  );
}

export function readExactEpisodeWorkflow<T extends EpisodeWorkflowIdentity>(
  query: QueryRead<T>,
  requested: Parameters<typeof matchesEpisodeWorkflow>[1],
): T | undefined {
  return query.status === "success" &&
    !query.error &&
    !query.isFetching &&
    query.isFetchedAfterMount &&
    matchesEpisodeWorkflow(query.data, requested)
    ? query.data
    : undefined;
}

// The workbench polls independently of the initial linked-request restore.
// Preserve an actually-read original during a later poll, but never another
// run/request or an error cache. Callers freeze actions during that poll.
export function readEpisodeWorkbenchWorkflow<T extends EpisodeWorkflowIdentity>(
  query: QueryRead<T>,
  requested: Parameters<typeof matchesEpisodeWorkflow>[1] & {
    request: EpisodeDevelopmentRequest;
  },
): T | undefined {
  return query.status === "success" &&
    !query.error &&
    query.isFetchedAfterMount &&
    matchesEpisodeWorkflow(query.data, requested) &&
    sameEpisodeDevelopmentRequest(
      query.data?.input.episodeDevelopmentRequest,
      requested.request,
    )
    ? query.data
    : undefined;
}
