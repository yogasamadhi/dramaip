import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, confirmDialog, NativeSelect } from "@dramaip/ui-shared";
import { Link } from "react-router-dom";
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

type FieldValue = ProductionRecordMergeComparison["units"][number]["base"];
function Value({ value }: { value: FieldValue }) {
  return (
    <p className="whitespace-pre-wrap break-words">
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
    <div aria-label="实际创作字段三方比较" className="space-y-3">
      <p>
        {report.units.filter((item) => item.conflict).length} 个真实字段冲突 ·
        原实际记录／当前人工记录／冻结候选。比较不写入；明确选择可另行冻结复检，不直接采用。语义质量尚未验证。
      </p>
      <p>
        自定义字段留在本域；归属和稳定身份不可迁移。顺序、时长、资产及来源结构只能采用原
        AI 草稿已冻结的专用计划，不能按创作字段重解释。
      </p>
      {report.format === "storyboard-record-field-comparison-v2" && (
        <section
          aria-label="字段合并冻结块映射"
          className="space-y-1 break-all"
        >
          <p>
            已确认块结构专用协议；仅采用原 AI
            草稿已冻结的原／新映射，不能用字段选择重写来源。
          </p>
          <p>
            正式剧本 {report.structure.script.id} v
            {report.structure.script.version} · 实际文档 v
            {report.structure.documentVersion}
          </p>
          {report.structure.receipt.sceneMappings.map((mapping) => (
            <p key={mapping.sceneId}>
              {mapping.sceneId} · 原块：{mapping.previousBlockIds.join("、")} ·
              新块：{mapping.currentBlockIds.join("、")}
            </p>
          ))}
          <p>结构指纹：{report.structureHash}</p>
        </section>
      )}
      {report.format === "storyboard-record-field-comparison-v3" && (
        <section
          aria-label="字段合并冻结镜头计划"
          className="space-y-2 break-all"
        >
          <p>
            作者镜头计划专用协议；身份、顺序、时长和资产方案引用只读。新增镜头没有旧实际字段，不补造三方比较；退役镜头保留当前历史原值。
          </p>
          <p>
            正式剧本 {report.structure.script.id} v
            {report.structure.script.version} · 实际文档 v
            {report.structure.documentVersion}
          </p>
          {report.structure.receipt.scenePlans.map((scene) => (
            <div key={scene.sceneId}>
              <p>
                场景 {scene.sceneId} · 原实际记录 {scene.recordId} v
                {scene.version}
              </p>
              {scene.shots.map((shot) => (
                <p key={shot.id}>
                  {shot.retains ? "复用" : "新增"}镜头 {shot.id} · 顺序{" "}
                  {shot.orderIndex} · {shot.durationSeconds} 秒 · 资产方案引用{" "}
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
                    退役镜头 {old.shotId} · 原实际记录 {old.recordId} v
                    {old.version} → 当前 v
                    {records.get(old.recordId)?.currentVersion}
                    ；仅冻结指纹，不显示私有历史正文。
                  </p>
                ))}
            </div>
          ))}
          {report.structure.receipt.sceneMappings.map((mapping) => (
            <p key={mapping.sceneId}>
              {mapping.sceneId} · 原块：{mapping.previousBlockIds.join("、")} ·
              新块：{mapping.currentBlockIds.join("、")}
            </p>
          ))}
          <p>结构指纹：{report.structureHash}</p>
        </section>
      )}
      {report.format === "storyboard-record-field-comparison-v4" && (
        <section
          aria-label="字段合并冻结场景拓扑计划"
          className="space-y-2 break-all"
        >
          <p>
            双正式人工确认场景拓扑专用协议。新增场景／镜头没有旧实际字段；退役记录只冻结当前指纹，不覆盖历史正文。语义仍未验证。
          </p>
          <p>
            正式大纲 {report.structure.receipt.outline.id} v
            {report.structure.receipt.outline.version} · 正式剧本{" "}
            {report.structure.script.id} v{report.structure.script.version} ·
            文档 v{report.structure.documentVersion}
          </p>
          {report.structure.receipt.topologyPlan.scenes.map((scene) => (
            <div key={scene.sceneId}>
              <p>
                {scene.mode === "retain"
                  ? "未选保留"
                  : scene.retains
                    ? "复用重做"
                    : "新增"}
                场景 {scene.sceneId} · 顺序 {scene.orderIndex} ·{" "}
                {scene.durationSeconds} 秒
                {scene.retains &&
                  ` · 实际 ${scene.retains.recordId} v${scene.retains.version}`}
              </p>
              {scene.shots.map((shot) => (
                <p key={shot.id}>
                  {shot.retains ? "同场复用" : "新增"}镜头 {shot.id} · 顺序{" "}
                  {shot.orderIndex} · {shot.durationSeconds} 秒 · 原方案资产{" "}
                  {shot.assetIds.join("、")}
                  {shot.retains &&
                    ` · 实际 ${shot.retains.recordId} v${shot.retains.version}`}
                </p>
              ))}
            </div>
          ))}
          {report.structure.receipt.topologyPlan.retiredScenes.map((scene) => (
            <p key={scene.recordId}>
              明确退役场景 {scene.sceneId} · 原实际 {scene.recordId} v
              {scene.version} → 当前 v
              {records.get(scene.recordId)?.currentVersion}（原字段只读保留）
            </p>
          ))}
          {report.structure.receipt.topologyPlan.retiredShots.map((shot) => (
            <p key={shot.recordId}>
              明确退役镜头 {shot.shotId} · 原实际 {shot.recordId} v
              {shot.version} → 当前 v
              {records.get(shot.recordId)?.currentVersion}（原字段只读保留）
            </p>
          ))}
          <p>
            已核人工拓扑祖先步骤 {report.structure.receipt.topologySteps} ·
            结构指纹 {report.structureHash}
          </p>
          {!report.units.length && (
            <p>
              此次没有复用可编辑旧字段；仍须明确复核完整新增与退役计划，不补造三方字段。
            </p>
          )}
        </section>
      )}
      {report.units.map((unit) => (
        <details key={unit.id}>
          <summary className="break-all">
            {unit.kind === "shots" ? "镜头" : "场景"}{" "}
            {records.get(unit.recordId)?.stableId} ·{" "}
            {unit.field === "title" ? "记录标题" : unit.field}：
            {unit.conflict ? "须明确选择冲突" : "未观察到字段冲突"}
          </summary>
          <div className="space-y-2 rounded border border-line p-3">
            <p className="break-all">
              实际记录 {unit.recordId} · 原 v
              {records.get(unit.recordId)?.frozenVersion} → 当前 v
              {records.get(unit.recordId)?.currentVersion}
            </p>
            <h5>原实际字段（非模型重建）</h5>
            <Value value={unit.base} />
            <h5>当前人工记录</h5>
            <Value value={unit.current} />
            <h5>冻结草稿</h5>
            <Value value={unit.candidate} />
            <p className="text-muted">
              未冲突字段的拟议默认：
              {unit.defaultChoice === "main"
                ? "保留当前人工值"
                : "使用冻结草稿值"}
              ；尚未写入。
            </p>
            {onChoice && (
              <label className="block">
                {unit.field === "title" ? "记录标题" : unit.field}选择 ·{" "}
                {records.get(unit.recordId)?.stableId}
                <NativeSelect
                  className="w-auto"
                  aria-label={`${records.get(unit.recordId)?.stableId} ${unit.field}选择`}
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
                    请明确选择真实冲突
                  </option>
                  <option value="main">保留当前人工值</option>
                  <option value="branch">使用冻结草稿值</option>
                </NativeSelect>
              </label>
            )}
          </div>
        </details>
      ))}
      <details>
        <summary>本次完整核对指纹</summary>
        <p className="break-all">{report.comparisonHash}</p>
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
      aria-label="正式场景镜头字段比较"
      className="space-y-2 rounded border border-line p-3 text-sm"
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
      <p className="text-muted">
        只读核对原基准、当前人工记录和冻结 AI
        草稿；不调用模型、不改稿、不解除原采用的版本保护。历史缺原基准不自动升级。
      </p>
      {opened && !query.isFetching && query.error && (
        <p role="alert" className="text-danger-strong">
          字段比较读取失败，旧缓存不能作为本轮核对。{message(query.error)}
        </p>
      )}
      {opened &&
        !query.isFetching &&
        !query.error &&
        query.data &&
        (!data || !matchesProductionRecordComparison(workflow, data)) && (
          <p role="alert" className="text-danger-strong">
            比较不属于当前客户端、AI 草稿或冻结基准；不补最新结果。
          </p>
        )}
      {currentRecovery?.error && (
        <p role="alert" className="text-danger-strong">
          {currentRecovery.error} 原请求保留；不会自动换字段或幂等键。
        </p>
      )}
      {currentRecovery?.request && (
        <div className="space-y-2" aria-label="字段合并原请求恢复">
          <p>
            本地仅保存原字段身份、选择、指纹与幂等键，不保存正文。重启不会自动提交；重新发送只恢复同一个实际运行。
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
            放弃本地原请求
          </Button>
        </div>
      )}
      {currentRecovery?.receipt && (
        <div aria-label="字段合并实际回执">
          <p>
            合并已冻结，另行复检／审阅，不自动采用。实际运行{" "}
            {currentRecovery.receipt.id} · {currentRecovery.receipt.stage}
          </p>
          <Link
            to={`/projects/${encodeURIComponent(workflow.input.projectId)}/tools/episode-development?operation=storyboard-package&workflowId=${encodeURIComponent(currentRecovery.receipt.id)}`}
          >
            打开字段合并草稿
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
          <label className="flex gap-2">
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
            我已逐项核对；明确同意将所选创作文字与原参考内容发给本次原配置模型复检。标题和场景动作独立选择，须核对与镜头一致性；不含私有自定义字段，不直接写入正式稿。
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
            冻结字段选择并复检
          </Button>
        </>
      )}
    </section>
  );
}
