import { useEffect, useRef, useState } from "react";
import { useQuery } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import { Link } from "../../router";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { ProductionRecordMergeComparison } from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import {
  currentProductionRecordComparison,
  matchesProductionRecordComparison,
} from "../../production-record-merge-view";
import {
  freezeProductionRecordMergeRequest,
  readProductionRecordMergeRequest,
  resendProductionRecordMerge,
  clearExactProductionRecordMergeRequest,
  productionRecordMergeStorageKey,
  type ProductionRecordMergeRecovery,
} from "../../production-record-merge-recovery";
import styles from "./ProductionRecordMergeReview.module.css";
import { copyText } from "../../copy";

type FieldValue = ProductionRecordMergeComparison["units"][number]["base"];
function Value({ value }: { value: FieldValue }) {
  return (
    <p className={styles.c1}>
      {value.state === "text"
        ? value.text
        : value.state === "absent"
          ? "实际字段缺失；不补造原文"
          : "实际字段不是文本；不外发原值或自动归一"}
    </p>
  );
}
export function ProductionRecordComparisonView({
  report,
  choices,
  onChoice,
  disabled,
}: {
  report: ProductionRecordMergeComparison;
  choices?: Record<string, "main" | "branch">;
  onChoice?: (id: string, choice: "main" | "branch") => void;
  disabled?: boolean;
}) {
  const records = new Map(report.records.map((item) => [item.id, item]));
  return (
    <div
      aria-label={copyText(
        "app/features/production/ProductionRecordMergeReview.1",
      )}
      className={styles.c2}
    >
      <p>
        {report.units.filter((item) => item.conflict).length}
        {copyText("app/features/production/ProductionRecordMergeReview.2")}
      </p>
      <p>{copyText("app/features/production/ProductionRecordMergeReview.3")}</p>
      {report.format === "storyboard-record-field-comparison-v2" && (
        <section
          aria-label={copyText(
            "app/features/production/ProductionRecordMergeReview.4",
          )}
          className={styles.c3}
        >
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.5")}
          </p>
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.6")}
            {report.structure.script.id}
            {copyText("app/features/production/ProductionRecordMergeReview.7")}
            {report.structure.script.version}
            {copyText("app/features/production/ProductionRecordMergeReview.8")}
            {report.structure.documentVersion}
          </p>
          {report.structure.receipt.sceneMappings.map((mapping) => (
            <p key={mapping.sceneId}>
              {mapping.sceneId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.9",
              )}
              {mapping.previousBlockIds.join("、")}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.10",
              )}
              {mapping.currentBlockIds.join("、")}
            </p>
          ))}
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.11")}
            {report.structureHash}
          </p>
        </section>
      )}
      {report.format === "storyboard-record-field-comparison-v3" && (
        <section
          aria-label={copyText(
            "app/features/production/ProductionRecordMergeReview.12",
          )}
          className={styles.c4}
        >
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.13")}
          </p>
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.6")}
            {report.structure.script.id}
            {copyText("app/features/production/ProductionRecordMergeReview.7")}
            {report.structure.script.version}
            {copyText("app/features/production/ProductionRecordMergeReview.8")}
            {report.structure.documentVersion}
          </p>
          {report.structure.receipt.scenePlans.map((scene) => (
            <div key={scene.sceneId}>
              <p>
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.14",
                )}
                {scene.sceneId}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.15",
                )}
                {scene.recordId}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.7",
                )}
                {scene.version}
              </p>
              {scene.shots.map((shot) => (
                <p key={shot.id}>
                  {shot.retains ? "复用" : "新增"}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.16",
                  )}
                  {shot.id}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.17",
                  )}{" "}
                  {shot.orderIndex} · {shot.durationSeconds}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.18",
                  )}{" "}
                  {shot.assetIds.join("、") || "无"}
                  {shot.retains &&
                    ` · 原实际记录 ${shot.retains.recordId} v${shot.retains.version}`}
                </p>
              ))}
              {report.structure.receipt.shots
                .filter(
                  (old) =>
                    records.get(old.recordId)?.parentId === scene.recordId &&
                    !scene.shots.some(
                      (shot) => shot.retains?.recordId === old.recordId,
                    ),
                )
                .map((old) => (
                  <p key={old.recordId}>
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.19",
                    )}
                    {old.shotId}
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.15",
                    )}
                    {old.recordId}
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.7",
                    )}
                    {old.version}
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.20",
                    )}
                    {records.get(old.recordId)?.currentVersion}
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.21",
                    )}
                  </p>
                ))}
            </div>
          ))}
          {report.structure.receipt.sceneMappings.map((mapping) => (
            <p key={mapping.sceneId}>
              {mapping.sceneId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.9",
              )}
              {mapping.previousBlockIds.join("、")}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.10",
              )}
              {mapping.currentBlockIds.join("、")}
            </p>
          ))}
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.11")}
            {report.structureHash}
          </p>
        </section>
      )}
      {report.format === "storyboard-record-field-comparison-v4" && (
        <section
          aria-label={copyText(
            "app/features/production/ProductionRecordMergeReview.22",
          )}
          className={styles.c4}
        >
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.23")}
          </p>
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.24")}
            {report.structure.receipt.outline.id}
            {copyText("app/features/production/ProductionRecordMergeReview.7")}
            {report.structure.receipt.outline.version}
            {copyText(
              "app/features/production/ProductionRecordMergeReview.25",
            )}{" "}
            {report.structure.script.id}
            {copyText("app/features/production/ProductionRecordMergeReview.7")}
            {report.structure.script.version}
            {copyText("app/features/production/ProductionRecordMergeReview.26")}
            {report.structure.documentVersion}
          </p>
          {report.structure.receipt.topologyPlan.scenes.map((scene) => (
            <div key={scene.sceneId}>
              <p>
                {scene.mode === "retain"
                  ? "未选保留"
                  : scene.retains
                    ? "复用重做"
                    : "新增"}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.14",
                )}
                {scene.sceneId}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.27",
                )}
                {scene.orderIndex} · {scene.durationSeconds}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.28",
                )}
                {scene.retains &&
                  ` · 实际 ${scene.retains.recordId} v${scene.retains.version}`}
              </p>
              {scene.shots.map((shot) => (
                <p key={shot.id}>
                  {shot.retains ? "同场复用" : "新增"}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.16",
                  )}
                  {shot.id}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.17",
                  )}{" "}
                  {shot.orderIndex} · {shot.durationSeconds}
                  {copyText(
                    "app/features/production/ProductionRecordMergeReview.29",
                  )}{" "}
                  {shot.assetIds.join("、")}
                  {shot.retains &&
                    ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`}
                </p>
              ))}
            </div>
          ))}
          {report.structure.receipt.topologyPlan.retiredScenes.map((scene) => (
            <p key={scene.recordId}>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.30",
              )}
              {scene.sceneId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.31",
              )}
              {scene.recordId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.7",
              )}
              {scene.version}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.20",
              )}
              {records.get(scene.recordId)?.currentVersion}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.32",
              )}
            </p>
          ))}
          {report.structure.receipt.topologyPlan.retiredShots.map((shot) => (
            <p key={shot.recordId}>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.33",
              )}
              {shot.shotId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.31",
              )}
              {shot.recordId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.7",
              )}
              {shot.version}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.20",
              )}
              {records.get(shot.recordId)?.currentVersion}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.32",
              )}
            </p>
          ))}
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.34")}
            {report.structure.receipt.topologySteps}
            {copyText("app/features/production/ProductionRecordMergeReview.35")}
            {report.structureHash}
          </p>
          {!report.units.length && (
            <p>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.36",
              )}
            </p>
          )}
        </section>
      )}
      {report.units.map((unit) => (
        <details key={unit.id}>
          <summary className={styles.c5}>
            {unit.kind === "shots" ? "镜头" : "场景"}{" "}
            {records.get(unit.recordId)?.stableId} ·{" "}
            {unit.field === "title" ? "记录标题" : unit.field}：
            {unit.conflict ? "须明确选择冲突" : "未观察到字段冲突"}
          </summary>
          <div className={styles.c6}>
            <p className={styles.c5}>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.37",
              )}
              {unit.recordId}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.38",
              )}
              {records.get(unit.recordId)?.frozenVersion}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.20",
              )}
              {records.get(unit.recordId)?.currentVersion}
            </p>
            <h5>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.39",
              )}
            </h5>
            <Value value={unit.base} />
            <h5>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.40",
              )}
            </h5>
            <Value value={unit.current} />
            <h5>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.41",
              )}
            </h5>
            <Value value={unit.candidate} />
            <p className={styles.c7}>
              {copyText(
                "app/features/production/ProductionRecordMergeReview.42",
              )}
              {unit.defaultChoice === "main"
                ? "保留当前人工值"
                : "使用冻结草稿值"}
              {copyText(
                "app/features/production/ProductionRecordMergeReview.43",
              )}
            </p>
            {onChoice && (
              <label className={styles.c8}>
                {unit.field === "title" ? "记录标题" : unit.field}
                {copyText(
                  "app/features/production/ProductionRecordMergeReview.44",
                )}{" "}
                {records.get(unit.recordId)?.stableId}
                <NativeSelect
                  className={styles.c9}
                  aria-label={copyText(
                    "app/features/production/ProductionRecordMergeReview.62",
                    {
                      p1: records.get(unit.recordId)?.stableId,
                      p2: unit.field,
                    },
                  )}
                  value={choices?.[unit.id] ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    if (["main", "branch"].includes(event.target.value))
                      onChoice(
                        unit.id,
                        event.target.value as "main" | "branch",
                      );
                  }}
                >
                  <option value="" disabled>
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.45",
                    )}
                  </option>
                  <option value="main">
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.46",
                    )}
                  </option>
                  <option value="branch">
                    {copyText(
                      "app/features/production/ProductionRecordMergeReview.47",
                    )}
                  </option>
                </NativeSelect>
              </label>
            )}
          </div>
        </details>
      ))}
      <details>
        <summary>
          {copyText("app/features/production/ProductionRecordMergeReview.48")}
        </summary>
        <p className={styles.c5}>{report.comparisonHash}</p>
      </details>
    </div>
  );
}
export function ProductionRecordMergeReview({
  workflow,
}: {
  workflow: CreationWorkflow;
}) {
  const client = useStudio(),
    basis = workflow.episodeDevelopmentBasis,
    base = basis?.storyboardRedo?.base;
  const identity = JSON.stringify([
    workflow.input.projectId,
    basis?.episode.id,
    workflow.id,
    workflow.version,
    workflow.stage,
    workflow.sourceSnapshotId,
    base?.id,
    base?.version,
  ]);
  const [openedFor, setOpenedFor] = useState<{
    client: typeof client;
    identity: string;
  }>();
  const opened =
    openedFor?.client === client && openedFor.identity === identity;
  const live = useRef({ client, identity });
  const confirming = useRef(false);
  live.current = { client, identity };
  const [selection, setSelection] = useState<{
    client: typeof client;
    hash: string;
    choices: Record<string, "main" | "branch">;
    acknowledged: boolean;
  }>();
  const [recovery, setRecovery] = useState<{
    client: typeof client;
    identity: string;
    request?: ProductionRecordMergeRecovery;
    receipt?: CreationWorkflow;
    error?: string;
    busy?: boolean;
  }>();
  useEffect(() => {
    setOpenedFor(undefined);
    setSelection(undefined);
    try {
      const request =
        base && basis
          ? readProductionRecordMergeRequest(
              localStorage.getItem(
                productionRecordMergeStorageKey(
                  workflow.input.projectId,
                  workflow.id,
                ),
              ),
              workflow.input.projectId,
              workflow.id,
              basis.episode.id,
              base.id,
            )
          : undefined;
      setRecovery({ client, identity, request });
    } catch (error) {
      setRecovery({ client, identity, error: message(error) });
    }
  }, [client, identity]);
  const eligible =
    workflow.stage === "awaiting-review" &&
    workflow.input.operation === "storyboard-package" &&
    Boolean(basis?.storyboardRedo) &&
    (basis?.storyboardRedo?.scope ===
    "confirmed-block-structure-fixed-shots-duration-assets-v1"
      ? basis.request.redoMode === "confirmed-block-structure"
      : basis?.storyboardRedo?.scope === "author-frozen-scene-topology-plan-v1"
        ? basis.request.redoMode === "scene-topology-plan"
        : basis?.storyboardRedo?.scope === "author-frozen-scene-shot-plan-v1"
          ? basis.request.redoMode === "scene-shot-plan"
          : !basis?.request.redoMode) &&
    !workflow.recordMergeSource;
  const query = useQuery({
    queryKey: ["production-record-merge", identity],
    enabled: false,
    retry: false,
    queryFn: async () => {
      if (!base || !basis || !eligible)
        throw new Error("原 AI 草稿范围已变化，不能比较实际字段。");
      return {
        client,
        report: await client.episodeDevelopments.compareRecords(workflow.id, {
          projectId: workflow.input.projectId,
          episodeId: basis.episode.id,
          workflowVersion: workflow.version,
          base,
          ...(basis.storyboardRedo?.scope ===
            "author-frozen-scene-topology-plan-v1" &&
          basis.request.script &&
          basis.request.baseScriptDocumentVersion !== undefined
            ? {
                confirmedTopologyPlan: {
                  receipt: basis.storyboardRedo,
                  script: basis.request.script,
                  documentVersion: basis.request.baseScriptDocumentVersion,
                },
              }
            : {}),
          ...(basis.storyboardRedo?.scope ===
            "author-frozen-scene-shot-plan-v1" &&
          basis.request.script &&
          basis.request.baseScriptDocumentVersion !== undefined
            ? {
                confirmedShotPlan: {
                  receipt: basis.storyboardRedo,
                  script: basis.request.script,
                  documentVersion: basis.request.baseScriptDocumentVersion,
                },
              }
            : {}),
          ...(basis.storyboardRedo?.scope ===
            "confirmed-block-structure-fixed-shots-duration-assets-v1" &&
          basis.request.script &&
          basis.request.baseScriptDocumentVersion !== undefined
            ? {
                confirmedStructure: {
                  receipt: basis.storyboardRedo,
                  script: basis.request.script,
                  documentVersion: basis.request.baseScriptDocumentVersion,
                },
              }
            : {}),
        }),
      };
    },
  });
  if (!eligible) return null;
  const data = query.data?.client === client ? query.data.report : undefined;
  const report = currentProductionRecordComparison({
    workflow,
    report: data,
    opened,
    fetching: query.isFetching,
    error: Boolean(query.error),
  });
  const currentRecovery =
    recovery?.client === client && recovery.identity === identity
      ? recovery
      : undefined;
  const selected =
    selection?.client === client && selection.hash === report?.comparisonHash
      ? selection
      : undefined;
  const choices =
    selected?.choices ??
    Object.fromEntries(
      (report?.units ?? [])
        .filter((unit) => !unit.conflict)
        .map((unit) => [unit.id, unit.defaultChoice]),
    );
  const resend = async (request: ProductionRecordMergeRecovery) => {
    const same = () =>
      live.current.client === client && live.current.identity === identity;
    setRecovery({ client, identity, request, busy: true });
    try {
      const receipt = await resendProductionRecordMerge(
        client.episodeDevelopments,
        request,
      );
      if (!same()) return;
      const stored = localStorage.getItem(
        productionRecordMergeStorageKey(
          request.input.projectId,
          request.input.workflow.id,
        ),
      );
      if (stored && stored !== JSON.stringify(request)) {
        const newer = readProductionRecordMergeRequest(
          stored,
          workflow.input.projectId,
          workflow.id,
          basis!.episode.id,
          base!.id,
        );
        setRecovery({
          client,
          identity,
          request: newer,
          error: "本地已有不同原请求，迟到回执不替换它；请核对并明确重发。",
        });
        return;
      }
      // A late response cannot clear a newer request written by another view.
      clearExactProductionRecordMergeRequest(localStorage, request);
      setRecovery({ client, identity, receipt });
    } catch (error) {
      if (same())
        setRecovery({ client, identity, request, error: message(error) });
    }
  };
  return (
    <section
      aria-label={copyText(
        "app/features/production/ProductionRecordMergeReview.49",
      )}
      className={styles.c10}
    >
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onClick={() => {
          setOpenedFor({ client, identity });
          void query.refetch();
        }}
      >
        {query.isFetching
          ? "读取实际字段…"
          : opened
            ? "重新比较实际字段"
            : "比较实际字段"}
      </Button>
      <p className={styles.c7}>
        {copyText("app/features/production/ProductionRecordMergeReview.50")}
      </p>
      {opened && !query.isFetching && query.error && (
        <p role="alert" className={styles.c11}>
          {copyText("app/features/production/ProductionRecordMergeReview.51")}
          {message(query.error)}
        </p>
      )}
      {opened &&
        !query.isFetching &&
        !query.error &&
        query.data &&
        (!data || !matchesProductionRecordComparison(workflow, data)) && (
          <p role="alert" className={styles.c11}>
            {copyText("app/features/production/ProductionRecordMergeReview.52")}
          </p>
        )}
      {currentRecovery?.error && (
        <p role="alert" className={styles.c11}>
          {currentRecovery.error}
          {copyText("app/features/production/ProductionRecordMergeReview.53")}
        </p>
      )}
      {currentRecovery?.request && (
        <div
          className={styles.c12}
          aria-label={copyText(
            "app/features/production/ProductionRecordMergeReview.54",
          )}
        >
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.55")}
          </p>
          <Button
            disabled={currentRecovery.busy}
            onClick={() => void resend(currentRecovery.request!)}
          >
            {currentRecovery.busy ? "核对原请求…" : "重发字段合并原请求"}
          </Button>
          <Button
            variant="secondary"
            disabled={currentRecovery.busy}
            onClick={() => {
              void (async () => {
                if (
                  !(await confirmDialog({
                    title: "放弃本地字段合并原请求？",
                    description:
                      "只移除本地身份、字段选择、指纹与幂等键，不删除服务器 AI 草稿或正式稿。若此前响应丢失，仍可在任务中查看实际运行。",
                    confirmLabel: "放弃本地原请求",
                  }))
                )
                  return;
                if (
                  live.current.client !== client ||
                  live.current.identity !== identity
                )
                  return;
                if (
                  clearExactProductionRecordMergeRequest(
                    localStorage,
                    currentRecovery.request!,
                  )
                )
                  setRecovery({ client, identity });
              })();
            }}
          >
            {copyText("app/features/production/ProductionRecordMergeReview.56")}
          </Button>
        </div>
      )}
      {currentRecovery?.receipt && (
        <div
          aria-label={copyText(
            "app/features/production/ProductionRecordMergeReview.57",
          )}
        >
          <p>
            {copyText("app/features/production/ProductionRecordMergeReview.58")}{" "}
            {currentRecovery.receipt.id} · {currentRecovery.receipt.stage}
          </p>
          <Link
            to={`/projects/${encodeURIComponent(workflow.input.projectId)}/tools/episode-development?operation=storyboard-package&workflowId=${encodeURIComponent(currentRecovery.receipt.id)}`}
          >
            {copyText("app/features/production/ProductionRecordMergeReview.59")}
          </Link>
        </div>
      )}
      {report && (
        <>
          <ProductionRecordComparisonView
            report={report}
            choices={choices}
            disabled={Boolean(
              currentRecovery?.request || currentRecovery?.busy,
            )}
            onChoice={(id, choice) =>
              setSelection({
                client,
                hash: report.comparisonHash,
                choices: { ...choices, [id]: choice },
                acknowledged: false,
              })
            }
          />
          <label className={styles.c13}>
            <input
              type="checkbox"
              checked={selected?.acknowledged ?? false}
              disabled={Boolean(
                currentRecovery?.request || currentRecovery?.busy,
              )}
              onChange={(event) =>
                setSelection({
                  client,
                  hash: report.comparisonHash,
                  choices,
                  acknowledged: event.target.checked,
                })
              }
            />
            {copyText("app/features/production/ProductionRecordMergeReview.60")}
          </label>
          <Button
            disabled={
              !selected?.acknowledged ||
              Object.keys(choices).length !== report.units.length ||
              Boolean(
                currentRecovery?.request ||
                currentRecovery?.busy ||
                currentRecovery?.error,
              )
            }
            onClick={() => {
              void (async () => {
                if (confirming.current) return;
                confirming.current = true;
                setRecovery({ client, identity, busy: true });
                try {
                  if (
                    !(await confirmDialog({
                      title: "冻结字段合并并另行复检",
                      description:
                        "保存原请求和全部选择，使用原配置模型复检一次。不重新生成、不立即采用；隐私／预算或实际记录再变则拒绝。",
                      confirmLabel: "冻结并复检",
                    }))
                  ) {
                    if (
                      live.current.client === client &&
                      live.current.identity === identity
                    )
                      setRecovery({ client, identity });
                    return;
                  }
                  if (
                    live.current.client !== client ||
                    live.current.identity !== identity
                  )
                    return;
                  const request = freezeProductionRecordMergeRequest({
                    ...(report.format ===
                    "storyboard-record-field-comparison-v4"
                      ? {
                          format:
                            "storyboard-record-field-merge-request-v4" as const,
                          structureHash: report.structureHash,
                        }
                      : report.format ===
                          "storyboard-record-field-comparison-v3"
                        ? {
                            format:
                              "storyboard-record-field-merge-request-v3" as const,
                            structureHash: report.structureHash,
                          }
                        : report.format ===
                            "storyboard-record-field-comparison-v2"
                          ? {
                              format:
                                "storyboard-record-field-merge-request-v2" as const,
                              structureHash: report.structureHash,
                            }
                          : {
                              format:
                                "storyboard-record-field-merge-request-v1" as const,
                            }),
                    projectId: report.projectId,
                    episodeId: report.episodeId,
                    workflow: report.workflow,
                    base: report.base,
                    comparisonHash: report.comparisonHash,
                    choices,
                    reviewed: true,
                    modelDisclosureConfirmed: true,
                  });
                  try {
                    localStorage.setItem(
                      productionRecordMergeStorageKey(
                        report.projectId,
                        report.workflow.id,
                      ),
                      JSON.stringify(request),
                    );
                  } catch (error) {
                    setRecovery({
                      client,
                      identity,
                      error: `原请求无法保存，不发送：${message(error)}`,
                    });
                    return;
                  }
                  await resend(request);
                } finally {
                  confirming.current = false;
                }
              })();
            }}
          >
            {copyText("app/features/production/ProductionRecordMergeReview.61")}
          </Button>
        </>
      )}
    </section>
  );
}
