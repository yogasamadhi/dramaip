import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@dramaip/ui-shared";
import type {
  EpisodeImpactReason,
  EpisodeDevelopmentImpact,
  StoryboardAttributionImpactSelection,
} from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import {
  currentEpisodeImpact,
  episodeImpactIdentityMatches,
  type EpisodeImpactReference,
} from "../../episode-impact-view";
import { EpisodeConstraintObservations } from "./EpisodeConstraintObservations";
import { ProductionRecordBaselines } from "./ProductionRecordBaselines";
import { ConfirmedSourceTransitionView } from "./ConfirmedSourceTransitionView";
import { readAllShotAttributionSummaries } from "../../storyboard-attribution-draft";
import { StoryboardAttributionImpactView } from "./StoryboardAttributionImpactView";
import { StoryboardSourceReviewComposer } from "./StoryboardSourceReviewComposer";
import type { StoryboardSourceReviewFrame } from "../../storyboard-source-review-state";

const labels: Record<EpisodeImpactReason, string> = {
  "source-block-changed": "镜头声明来源块变化",
  "scene-structure-changed": "场景块新增、移除或顺序变化",
  "scene-context-changed": "场景标题、人物或控制上下文变化",
  "scene-record-changed": "实际场景版本变化",
  "shot-record-changed": "实际镜头版本变化",
  "record-unavailable": "实际记录缺失或绑定不符",
  "mapping-unresolved": "冻结记录映射未核全",
  "upstream-not-localized": "有上游变化不能局部定位",
};
export function EpisodeImpactPanel({
  result,
  sourceReview,
}: {
  result: EpisodeImpactReference;
  sourceReview?: {
    scopeKey: string;
    selectedShotIds: readonly string[];
    onFreeze(frame: StoryboardSourceReviewFrame): void;
    onInvalidate(): void;
  };
}) {
  const client = useStudio();
  const resultIdentity = `${result.projectId}:${result.episodeId}:${result.id}:${result.version}`;
  const [selectedFor, setSelectedFor] = useState<{
    client: typeof client;
    identity: string;
    attribution: StoryboardAttributionImpactSelection;
  }>();
  const selected =
    selectedFor?.client === client && selectedFor.identity === resultIdentity
      ? selectedFor.attribution
      : undefined;
  const identity = `${resultIdentity}:${selected?.id ?? "none"}:${selected?.version ?? "none"}`;
  const currentIdentity = useRef({ client, identity });
  currentIdentity.current = { client, identity };
  const attempt = useRef(0);
  const [actualFor, setActualFor] = useState<{
    client: typeof client;
    identity: string;
    report: EpisodeDevelopmentImpact;
  }>();
  const [catalogFor, setCatalogFor] = useState<{
    client: typeof client;
    identity: string;
  }>();
  const [openedFor, setOpenedFor] = useState<{
    client: typeof client;
    identity: string;
  }>();
  const opened =
    openedFor?.client === client && openedFor.identity === identity;
  useEffect(() => {
    setOpenedFor(undefined);
    setSelectedFor(undefined);
    setCatalogFor(undefined);
  }, [client, resultIdentity]);
  const catalogOpened =
    catalogFor?.client === client && catalogFor.identity === resultIdentity;
  const history = useQuery({
    queryKey: [
      "episode-impact-attribution-summaries",
      result.projectId,
      result.episodeId,
      result.id,
      result.version,
    ],
    queryFn: () => readAllShotAttributionSummaries(client, result.projectId),
    enabled: catalogOpened,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const associations =
    history.isSuccess &&
    !history.isError &&
    !history.isFetching &&
    history.isFetchedAfterMount
      ? history.data.filter(
          (item) =>
            item.status === "adopted" &&
            item.projectId === result.projectId &&
            item.episodeId === result.episodeId &&
            item.storyboard.id === result.id &&
            item.storyboard.version === result.version,
        )
      : undefined;
  const query = useQuery({
    queryKey: [
      "episode-impact",
      result.projectId,
      result.episodeId,
      result.id,
      result.version,
      selected?.id ?? null,
      selected?.version ?? null,
    ],
    queryFn: () =>
      client.episodeDevelopments.impact(result.id, result, selected),
    enabled: false,
    retry: false,
  });
  const report = {
    ...query,
    error: opened && !query.isFetching ? query.error : null,
    data: currentEpisodeImpact({
      reference: result,
      report:
        actualFor?.client === client && actualFor.identity === identity
          ? actualFor.report
          : undefined,
      opened,
      fetching: query.isFetching,
      error: Boolean(query.error),
      attribution: selected,
    }),
  };
  const invalidateReview = sourceReview?.onInvalidate;
  useEffect(() => {
    invalidateReview?.();
  }, [client, identity, sourceReview?.scopeKey, invalidateReview]);
  useEffect(() => {
    if (!report.data || history.isError || history.isFetching)
      invalidateReview?.();
  }, [report.data, history.isError, history.isFetching, invalidateReview]);
  return (
    <section
      aria-label="分镜实际变化影响"
      className="space-y-2 rounded border border-line p-3 text-sm"
    >
      <Button
        variant="secondary"
        disabled={report.isFetching}
        onClick={() => {
          invalidateReview?.();
          setActualFor(undefined);
          const ticket = ++attempt.current;
          setOpenedFor({ client, identity });
          setCatalogFor({ client, identity: resultIdentity });
          void query.refetch().then((value) => {
            if (
              ticket === attempt.current &&
              currentIdentity.current.client === client &&
              currentIdentity.current.identity === identity &&
              !value.error &&
              value.data &&
              episodeImpactIdentityMatches(result, value.data, selected)
            )
              setActualFor({ client, identity, report: value.data });
          });
        }}
      >
        {report.isFetching
          ? "核对实际变化…"
          : opened
            ? "重新核对变化影响"
            : "核对变化影响"}
      </Button>
      <p className="text-muted">
        只读比较正式快照与实际稳定块、场景及镜头版本；不调用模型、不改稿、不自动重做。未观察到关联变化不证明语义安全，来源失效仍须重新确认。
      </p>
      {catalogOpened && (
        <div className="space-y-2">
          <label className="block">
            原人工关联版本（可选）
            <select
              aria-label="影响观察原关联版本"
              className="mt-1 w-full rounded border border-line bg-panel p-2"
              disabled={query.isFetching || !associations}
              value={selected ? `${selected.id}:${selected.version}` : ""}
              onChange={(event) => {
                const value = associations?.find(
                  (item) => `${item.id}:${item.version}` === event.target.value,
                );
                if (event.target.value && !value) return;
                invalidateReview?.();
                ++attempt.current;
                setActualFor(undefined);
                setSelectedFor(
                  value
                    ? {
                        client,
                        identity: resultIdentity,
                        attribution: { id: value.id, version: value.version },
                      }
                    : undefined,
                );
                setOpenedFor(undefined);
              }}
            >
              <option value="">不附人工关联，不自动选择最新</option>
              {selected &&
                !associations?.some(
                  (item) =>
                    item.id === selected.id &&
                    item.version === selected.version,
                ) && (
                  <option value={`${selected.id}:${selected.version}`}>
                    原选择 {selected.id} · v{selected.version}（目录本次未核全）
                  </option>
                )}
              {associations?.map((item) => (
                <option key={item.id} value={`${item.id}:${item.version}`}>
                  {item.id} · v{item.version} ·{" "}
                  {item.isCurrent ? "当前采用" : "历史采用"} ·{" "}
                  {item.sourceState === "current"
                    ? "来源当前"
                    : item.sourceState === "stale"
                      ? "来源变化"
                      : "来源未核全"}
                </option>
              ))}
            </select>
          </label>
          <p className="text-muted">
            明确选择后再点“核对变化影响”，读取同一原关联版本；来源变化的历史可以观察，但不能自动改连节点、换引文位置或解除复核。
          </p>
          {history.isError && (
            <p role="alert" className="text-danger-strong">
              原关联目录本次读取失败，不用旧缓存或最近关联替代。
              {message(history.error)}
              <Button
                variant="secondary"
                disabled={history.isFetching}
                onClick={() => {
                  void history.refetch();
                }}
              >
                重新读取原关联目录
              </Button>
            </p>
          )}
        </div>
      )}
      {report.error && (
        <p role="alert" className="text-danger-strong">
          影响清单读取失败，旧缓存不能作为本轮核对结果；请明确重读同一成果。
          {message(report.error)}
        </p>
      )}
      {opened &&
        !query.isFetching &&
        !query.error &&
        query.data &&
        !episodeImpactIdentityMatches(result, query.data, selected) && (
          <p role="alert" className="text-danger-strong">
            影响清单与指定成果、项目、分集或版本不符；不能使用旧缓存或最新结果代替。
          </p>
        )}
      {report.data && (
        <>
          <EpisodeConstraintObservations
            value={report.data.upstreamConstraints}
          />
          <ProductionRecordBaselines value={report.data.recordBaselines} />
          <ConfirmedSourceTransitionView
            value={report.data.confirmedSourceTransition}
          />
          {report.data.attributionImpact && (
            <StoryboardAttributionImpactView
              value={report.data.attributionImpact}
            />
          )}
          {sourceReview &&
            selected &&
            !history.isError &&
            associations?.some(
              (item) =>
                item.id === selected.id && item.version === selected.version,
            ) && (
              <StoryboardSourceReviewComposer
                key={JSON.stringify([sourceReview.scopeKey, report.data])}
                reference={result}
                attribution={selected}
                report={report.data}
                selectedShotIds={sourceReview.selectedShotIds}
                scopeKey={sourceReview.scopeKey}
                onFreeze={sourceReview.onFreeze}
                onInvalidate={sourceReview.onInvalidate}
              />
            )}
          <p>
            冻结剧本文档 v{report.data.script.frozenDocumentVersion ?? "未知"} →
            实际 v{report.data.script.currentDocumentVersion ?? "缺失"} ·{" "}
            {report.data.blockChanges.length} 个稳定块变化
          </p>
          {report.data.staleReasons.map((reason) => (
            <p key={reason} className="text-danger-strong">
              来源门：{reason}
            </p>
          ))}
          {report.data.globalReviewReasons.map((reason) => (
            <p key={reason} className="text-danger-strong">
              全包需复核：{reason}
            </p>
          ))}
          <p>
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "affected",
              ).length
            }{" "}
            个关联受影响 ·{" "}
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "no-observed-change",
              ).length
            }{" "}
            个未观察到关联变化 ·{" "}
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "unresolved",
              ).length
            }{" "}
            个范围未核全
          </p>
          {report.data.shots.map((shot) => (
            <details key={shot.shotId}>
              <summary className="break-all">
                场景 {shot.sceneId} · 镜头 {shot.shotId}：
                {shot.associationImpact === "affected"
                  ? "关联受影响"
                  : shot.associationImpact === "unresolved"
                    ? "范围未核全，需复核"
                    : "未观察到关联变化"}
              </summary>
              <p className="break-all">
                实际记录：
                {shot.record
                  ? `${shot.record.id} · 冻结 v${shot.record.frozenVersion} → 实际 v${shot.record.currentVersion ?? "缺失"}`
                  : "映射缺失"}
              </p>
              {shot.reasonCodes.map((code) => (
                <p key={code}>{labels[code]}</p>
              ))}
              {shot.changedBlockIds.length > 0 && (
                <p className="break-all">
                  变化稳定块：{shot.changedBlockIds.join("、")}
                </p>
              )}
            </details>
          ))}
          <details>
            <summary>正文隔离的稳定块差异与核对指纹</summary>
            {report.data.blockChanges.map((change) => (
              <p key={change.blockId} className="break-all">
                {change.blockId} · {change.kind} ·{" "}
                {change.fields.join("、") || "存在性变化"}
              </p>
            ))}
            <p className="break-all">{report.data.snapshotHash}</p>
          </details>
        </>
      )}
    </section>
  );
}
