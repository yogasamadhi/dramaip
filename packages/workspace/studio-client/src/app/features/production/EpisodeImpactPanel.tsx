import { useEffect, useRef, useState } from "react";
import { useQuery } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
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
import styles from "./EpisodeImpactPanel.module.css";
import { copyText } from "../../copy";

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
      aria-label={copyText("app/features/production/EpisodeImpactPanel.1")}
      className={styles.c1}
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
      <p className={styles.c2}>
        {copyText("app/features/production/EpisodeImpactPanel.2")}
      </p>
      {catalogOpened && (
        <div className={styles.c3}>
          <label className={styles.c4}>
            {copyText("app/features/production/EpisodeImpactPanel.3")}
            <NativeSelect
              aria-label={copyText(
                "app/features/production/EpisodeImpactPanel.4",
              )}
              className={styles.c5}
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
              <option value="">
                {copyText("app/features/production/EpisodeImpactPanel.5")}
              </option>
              {selected &&
                !associations?.some(
                  (item) =>
                    item.id === selected.id &&
                    item.version === selected.version,
                ) && (
                  <option value={`${selected.id}:${selected.version}`}>
                    {copyText("app/features/production/EpisodeImpactPanel.6")}
                    {selected.id}
                    {copyText("app/features/production/EpisodeImpactPanel.7")}
                    {selected.version}
                    {copyText("app/features/production/EpisodeImpactPanel.8")}
                  </option>
                )}
              {associations?.map((item) => (
                <option key={item.id} value={`${item.id}:${item.version}`}>
                  {item.id}
                  {copyText("app/features/production/EpisodeImpactPanel.7")}
                  {item.version} · {item.isCurrent ? "当前采用" : "历史采用"} ·{" "}
                  {item.sourceState === "current"
                    ? "来源当前"
                    : item.sourceState === "stale"
                      ? "来源变化"
                      : "来源未核全"}
                </option>
              ))}
            </NativeSelect>
          </label>
          <p className={styles.c2}>
            {copyText("app/features/production/EpisodeImpactPanel.9")}
          </p>
          {history.isError && (
            <p role="alert" className={styles.c6}>
              {copyText("app/features/production/EpisodeImpactPanel.10")}
              {message(history.error)}
              <Button
                variant="secondary"
                disabled={history.isFetching}
                onClick={() => {
                  void history.refetch();
                }}
              >
                {copyText("app/features/production/EpisodeImpactPanel.11")}
              </Button>
            </p>
          )}
        </div>
      )}
      {report.error && (
        <p role="alert" className={styles.c6}>
          {copyText("app/features/production/EpisodeImpactPanel.12")}
          {message(report.error)}
        </p>
      )}
      {opened &&
        !query.isFetching &&
        !query.error &&
        query.data &&
        !episodeImpactIdentityMatches(result, query.data, selected) && (
          <p role="alert" className={styles.c6}>
            {copyText("app/features/production/EpisodeImpactPanel.13")}
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
            {copyText("app/features/production/EpisodeImpactPanel.14")}
            {report.data.script.frozenDocumentVersion ?? "未知"}
            {copyText("app/features/production/EpisodeImpactPanel.15")}
            {report.data.script.currentDocumentVersion ?? "缺失"} ·{" "}
            {report.data.blockChanges.length}
            {copyText("app/features/production/EpisodeImpactPanel.16")}
          </p>
          {report.data.staleReasons.map((reason) => (
            <p key={reason} className={styles.c6}>
              {copyText("app/features/production/EpisodeImpactPanel.17")}
              {reason}
            </p>
          ))}
          {report.data.globalReviewReasons.map((reason) => (
            <p key={reason} className={styles.c6}>
              {copyText("app/features/production/EpisodeImpactPanel.18")}
              {reason}
            </p>
          ))}
          <p>
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "affected",
              ).length
            }{" "}
            {copyText("app/features/production/EpisodeImpactPanel.19")}{" "}
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "no-observed-change",
              ).length
            }{" "}
            {copyText("app/features/production/EpisodeImpactPanel.20")}{" "}
            {
              report.data.shots.filter(
                (shot) => shot.associationImpact === "unresolved",
              ).length
            }{" "}
            {copyText("app/features/production/EpisodeImpactPanel.21")}
          </p>
          {report.data.shots.map((shot) => (
            <details key={shot.shotId}>
              <summary className={styles.c7}>
                {copyText("app/features/production/EpisodeImpactPanel.22")}
                {shot.sceneId}
                {copyText("app/features/production/EpisodeImpactPanel.23")}
                {shot.shotId}：
                {shot.associationImpact === "affected"
                  ? "关联受影响"
                  : shot.associationImpact === "unresolved"
                    ? "范围未核全，需复核"
                    : "未观察到关联变化"}
              </summary>
              <p className={styles.c7}>
                {copyText("app/features/production/EpisodeImpactPanel.24")}
                {shot.record
                  ? `${shot.record.id} · 冻结 v${shot.record.frozenVersion} → 实际 v${shot.record.currentVersion ?? "缺失"}`
                  : "映射缺失"}
              </p>
              {shot.reasonCodes.map((code) => (
                <p key={code}>{labels[code]}</p>
              ))}
              {shot.changedBlockIds.length > 0 && (
                <p className={styles.c7}>
                  {copyText("app/features/production/EpisodeImpactPanel.25")}
                  {shot.changedBlockIds.join("、")}
                </p>
              )}
            </details>
          ))}
          <details>
            <summary>
              {copyText("app/features/production/EpisodeImpactPanel.26")}
            </summary>
            {report.data.blockChanges.map((change) => (
              <p key={change.blockId} className={styles.c7}>
                {change.blockId} · {change.kind} ·{" "}
                {change.fields.join("、") || "存在性变化"}
              </p>
            ))}
            <p className={styles.c7}>{report.data.snapshotHash}</p>
          </details>
        </>
      )}
    </section>
  );
}
