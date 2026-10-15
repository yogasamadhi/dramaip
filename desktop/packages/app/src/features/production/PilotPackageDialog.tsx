import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  Textarea,
  NativeSelect,
} from "@dramaip/ui-shared";
import type { PilotPackagePreview } from "@dramaip/contracts/delivery";
import { message, useStudio } from "../../studio-shared";
import { readAllShotAttributionSummaries } from "../../storyboard-attribution-draft";
import { matchesExactPilotPackage } from "../../episode-development-navigation";

export const pilotPackageStatusLabel = {
  "awaiting-confirmation": "待明确确认",
  saving: "保存中 / 尚无完成回执",
  saved: "已保存并核验",
  canceled: "已取消，未记录交付",
  failed: "保存失败或回执未核验",
};

export function PilotPackageDialog(props: {
  projectId: string;
  storyboard?: { id: string; version: number };
  previewId?: string;
  episodeId?: string;
  onClose(): void;
  onUpdated(): void;
}) {
  const client = useStudio();
  const [preview, setPreview] = useState<PilotPackagePreview>();
  const [includeNle, setIncludeNle] = useState(true);
  const [includeWorkflowLineage, setIncludeWorkflowLineage] = useState(false);
  const [fileName, setFileName] = useState("README.md");
  const [basis, setBasis] = useState<
    "original" | "authorized" | "public-domain"
  >("original");
  const [note, setNote] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [internalConfirmed, setInternalConfirmed] = useState(false);
  const [unknownConfirmed, setUnknownConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [shotAttributionId, setShotAttributionId] = useState("");
  const attributions = useQuery({
    queryKey: [
      "pilot-shot-attribution-summaries",
      props.projectId,
      props.storyboard?.id,
      props.storyboard?.version,
    ],
    enabled: !props.previewId && Boolean(props.storyboard),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
    queryFn: () => readAllShotAttributionSummaries(client, props.projectId),
  });
  const eligibleAttributions =
    attributions.isSuccess &&
    !attributions.isError &&
    attributions.isFetchedAfterMount
      ? attributions.data.filter(
          (value) =>
            value.storyboard.id === props.storyboard?.id &&
            value.storyboard.version === props.storyboard?.version &&
            value.status === "adopted" &&
            value.isCurrent &&
            value.sourceState === "current",
        )
      : [];
  const selectedAttribution = eligibleAttributions.find(
    (value) => value.id === shotAttributionId,
  );
  useEffect(() => {
    let alive = true;
    setPreview(undefined);
    setError(undefined);
    setBasis("original");
    setNote("");
    setFileName("README.md");
    setWorking(Boolean(props.previewId));
    setRightsConfirmed(false);
    setInternalConfirmed(false);
    setUnknownConfirmed(false);
    setShotAttributionId("");
    setIncludeWorkflowLineage(false);
    if (props.previewId) {
      setWorking(true);
      void client.pilotPackages
        .get(props.previewId)
        .then((value) => {
          if (!alive) return;
          if (
            !matchesExactPilotPackage(value, {
              previewId: props.previewId!,
              projectId: props.projectId,
              episodeId: props.episodeId,
            })
          )
            throw new Error(
              "试制包与指定原包、项目或单集不一致；未打开其他包。",
            );
          setPreview(value);
          setBasis(value.rights?.basis ?? "original");
          setNote(value.rights?.note ?? "");
        })
        .catch((cause) => {
          if (alive) setError(message(cause));
        })
        .finally(() => {
          if (alive) setWorking(false);
        });
    }
    return () => {
      alive = false;
    };
  }, [
    client,
    props.projectId,
    props.previewId,
    props.episodeId,
    props.storyboard?.id,
    props.storyboard?.version,
  ]);
  const prepare = async () => {
    if (!props.storyboard) return;
    setWorking(true);
    setError(undefined);
    setRightsConfirmed(false);
    setInternalConfirmed(false);
    setUnknownConfirmed(false);
    try {
      let shotAttribution: { id: string; version: number } | undefined;
      if (shotAttributionId) {
        if (
          !selectedAttribution ||
          attributions.isError ||
          attributions.isFetching
        )
          throw new Error(
            "明确所选镜头关联尚未本次核对，不沿用缓存或最新关联。",
          );
        const original = await client.storyboardAttributions.get(
          props.projectId,
          shotAttributionId,
        );
        if (
          original.version !== selectedAttribution.version ||
          original.status !== "adopted" ||
          !original.isCurrent ||
          original.sourceState !== "current" ||
          original.source.storyboard.id !== props.storyboard.id ||
          original.source.storyboard.version !== props.storyboard.version ||
          original.associationFingerprint !==
            selectedAttribution.associationFingerprint ||
          original.source.sourceFingerprint !==
            selectedAttribution.sourceFingerprint
        )
          throw new Error("明确所选采用关联或来源已改变；不自动附上新版本。");
        shotAttribution = { id: original.id, version: original.version };
      }
      const project = await client.projects.get(props.projectId);
      const value = await client.pilotPackages.preview(
        props.projectId,
        {
          projectVersion: project.version,
          storyboard: props.storyboard,
          includeNle,
          ...(includeWorkflowLineage ? { includeWorkflowLineage: true } : {}),
          ...(shotAttribution ? { shotAttribution } : {}),
        },
        crypto.randomUUID(),
      );
      setPreview(value);
      props.onUpdated();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const reload = async () => {
    if (!preview) return;
    setWorking(true);
    setError(undefined);
    try {
      const value = await client.pilotPackages.get(preview.id);
      if (
        !matchesExactPilotPackage(value, {
          previewId: preview.id,
          projectId: props.projectId,
          episodeId: props.episodeId,
        })
      )
        throw new Error("试制包与指定原包、项目或单集不一致；未打开其他包。");
      setPreview(value);
      props.onUpdated();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    if (
      !preview ||
      !canSave ||
      working ||
      !rightsConfirmed ||
      !internalConfirmed ||
      !unknownConfirmed
    )
      return;
    setWorking(true);
    setError(undefined);
    try {
      const value = await client.pilotPackages.save(
        preview.id,
        {
          version: preview.version,
          archiveSha256: preview.archive.sha256,
          rights: { basis, note, confirmed: true },
          internalReviewConfirmed: true,
          unverifiedChecksAcknowledged: true,
        },
        crypto.randomUUID(),
      );
      setPreview(value);
      props.onUpdated();
      if (value.error) setError(value.error);
    } catch (cause) {
      setError(message(cause));
      // Timeout is not proof of failure. Read the SAME persisted record;
      // never automatically repeat the Host dialog or create another export.
      try {
        const value = await client.pilotPackages.get(preview.id);
        if (
          !matchesExactPilotPackage(value, {
            previewId: preview.id,
            projectId: props.projectId,
            episodeId: props.episodeId,
          })
        )
          throw new Error("试制包与指定原包、项目或单集不一致；未打开其他包。");
        setPreview(value);
        props.onUpdated();
      } catch {
        /* Keep known state; a later explicit refresh can verify it. */
      }
    } finally {
      setWorking(false);
    }
  };
  const selectedFile =
    preview?.files.find((file) => file.fileName === fileName) ??
    preview?.files[0];
  const canSave =
    !error &&
    preview?.manifest.projectId === props.projectId &&
    (props.episodeId === undefined ||
      preview?.manifest.episodeId === props.episodeId) &&
    (props.previewId
      ? preview?.id === props.previewId
      : preview?.manifest.adopted.storyboard.id === props.storyboard?.id &&
        preview?.manifest.adopted.storyboard.version ===
          props.storyboard?.version) &&
    preview?.status === "awaiting-confirmation" &&
    preview.sourceState === "current" &&
    !preview.manifest.preflight.blockers.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) props.onClose();
      }}
    >
      <Dialog.Content
        className="max-w-4xl"
        aria-label="内部试制交付预览"
        closeLabel="关闭试制预览"
      >
        <Dialog.Title>核验并保存内部试制包</Dialog.Title>
        <Dialog.Description>
          冻结已采用大纲、剧本与分镜的实际版本。仅供内部试制审阅，不是叙事质量、授权证明或发行就绪保证；导出不生成媒体、不授权费用。
        </Dialog.Description>
        <div className="mt-4 max-h-[65vh] space-y-4 overflow-y-auto">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {error && preview && (
            <InlineNotice tone="warning">
              当前读取或操作尚未核对，已显示的冻结版本仅供历史查看，不能确认保存；请明确刷新同一试制包。
            </InlineNotice>
          )}
          {!preview ? (
            <>
              {props.storyboard && (
                <p className="text-sm break-all">
                  正式分镜 {props.storyboard.id} · v{props.storyboard.version}
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeNle}
                  disabled={working}
                  onChange={(event) => setIncludeNle(event.target.checked)}
                />
                纳入实际已有的 NLE 时间线导出；不存在时标记缺失，不创建时间线
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeWorkflowLineage}
                  disabled={working}
                  onChange={(event) =>
                    setIncludeWorkflowLineage(event.target.checked)
                  }
                />
                明确附所选三正式阶段的原工作流脱敏谱系（不含指令、正文或 AI
                草稿；缺失保留未知，人工确认不当新模型运行）
              </label>
              <label className="block text-sm">
                可选：明确已采用的逐镜头关联
                <NativeSelect
                  aria-label="试制包明确镜头关联"
                  className="mt-1 w-full"
                  value={shotAttributionId}
                  disabled={working}
                  onChange={(event) => setShotAttributionId(event.target.value)}
                >
                  <option value="">
                    不附逐镜头关联（默认；场景继承不冒充镜头归因）
                  </option>
                  {shotAttributionId && !selectedAttribution && (
                    <option value={shotAttributionId}>
                      原明确选择未核对／已失效：{shotAttributionId}
                    </option>
                  )}
                  {eligibleAttributions.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.id} v{value.version} ·{" "}
                      {value.coverage.associatedShots}/
                      {value.coverage.totalShots} 镜头；节点{" "}
                      {value.coverage.nodeAssociatedShots}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <p className="text-xs text-muted">
                明确所选版本另行重读后才创建预览；关联文件仅含引用／hash／位置／实际覆盖，不导出私人理由、引文或节点正文，不证明语义和权利通过。
              </p>
              {attributions.isError && (
                <InlineNotice tone="warning">
                  关联目录本次读取失败，不显示旧缓存。无关联选择仍可预览内部包；已有明确选择不自动取消。
                  {message(attributions.error)}
                </InlineNotice>
              )}
              <Button
                disabled={
                  working ||
                  !props.storyboard ||
                  Boolean(
                    shotAttributionId &&
                    (!selectedAttribution || attributions.isFetching),
                  )
                }
                onClick={() => void prepare()}
              >
                生成统一试制包预览
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium text-sm">
                {preview.manifest.projectTitle} ·{" "}
                {preview.manifest.episodeTitle} ·{" "}
                {pilotPackageStatusLabel[preview.status]}
              </p>
              <p className="text-xs text-muted">
                {preview.files.length} 个文件 · ZIP {preview.archive.byteSize}{" "}
                字节 · {preview.manifest.durationSeconds} 秒分镜方案（不是成片）
              </p>
              <p className="break-all text-xs text-muted">
                ZIP SHA-256：{preview.archive.sha256}
              </p>
              <details>
                <summary className="text-sm">核对实际采用版本与来源</summary>
                <ul className="mt-2 space-y-1 break-all text-xs">
                  {Object.entries(preview.manifest.adopted).flatMap(
                    ([label, ref]) =>
                      ref && "id" in ref && "version" in ref
                        ? [
                            <li key={label}>
                              {label}：{ref.id} v{ref.version}
                            </li>,
                          ]
                        : [],
                  )}
                  {preview.manifest.adopted.directSource && (
                    <li>
                      直写来源：
                      {preview.manifest.adopted.directSource.entryPath ===
                      "script"
                        ? "已有剧本"
                        : "作者创意简报"}{" "}
                      · 项目 v
                      {preview.manifest.adopted.directSource.project.version}
                      {preview.manifest.adopted.directSource.sourceScript
                        ? ` · 原剧本 v${preview.manifest.adopted.directSource.sourceScript.version}`
                        : ""}
                      ；没有小说、诊断或季纲版本。
                    </li>
                  )}
                </ul>
              </details>
              {preview.sourceState === "stale" && (
                <InlineNotice tone="warning">
                  来源已变化，此包只代表历史版本，不能证明当前版本已交付。
                  {preview.sourceIssues.join(" ")}
                </InlineNotice>
              )}
              <section className="space-y-2" aria-label="试制交付预检">
                <h3 className="font-medium text-sm">交付预检与未核验事项</h3>
                {preview.manifest.preflight.checks.map((check) => (
                  <p key={check.id} className="text-sm">
                    <span className="font-medium">
                      {check.label}：
                      {check.state === "passed"
                        ? check.id === "quality"
                          ? "评议证据已核对（不是质量保证）"
                          : "规则范围内通过"
                        : check.state === "blocked"
                          ? "阻断"
                          : "未核验"}
                    </span>{" "}
                    · {check.detail}
                  </p>
                ))}
                {preview.manifest.qualityEvidence?.map((value) => (
                  <div
                    key={`${value.target.kind}:${value.target.id}`}
                    className="rounded border border-line p-3 text-sm"
                    data-delivery-quality-target={value.target.id}
                  >
                    <p>
                      {value.target.id === preview.manifest.adopted.outline.id
                        ? "单集大纲"
                        : value.target.id === preview.manifest.adopted.script.id
                          ? "标准剧本"
                          : value.target.id ===
                              preview.manifest.adopted.storyboard.id
                            ? "分镜方案"
                            : value.target.kind === "script"
                              ? "实际保存剧本"
                              : value.target.kind === "scene"
                                ? "实际保存场景"
                                : "目标"}{" "}
                      v{value.target.version} · 已核对{" "}
                      {value.reviewedDimensions.length}/
                      {value.requiredDimensions.length} 个维度 ·{" "}
                      {value.blockers.length} 项未处理错误 ·{" "}
                      {value.acceptedRiskCount} 项明确接受风险
                    </p>
                    {value.target.sourceFingerprint && (
                      <p
                        className="break-all text-xs text-muted"
                        data-delivery-quality-fingerprint={
                          value.target.sourceFingerprint
                        }
                      >
                        目标 {value.target.kind}:{value.target.id} · SHA-256{" "}
                        {value.target.sourceFingerprint}
                        ；只对应实际保存表达，不补整包覆盖。
                      </p>
                    )}
                    {value.reports.map((report) => (
                      <Link
                        key={report.id}
                        className="mt-2 block break-all text-link"
                        to={`/projects/${props.projectId}/tools/quality-review?reportId=${report.id}`}
                        onClick={props.onClose}
                      >
                        打开实际报告 {report.id} · 版本 v{report.version}
                      </Link>
                    ))}
                  </div>
                ))}
                {preview.manifest.localQualityEvidence?.map((value) => (
                  <div
                    key={`local:${value.target.kind}:${value.target.id}`}
                    className="rounded border border-line p-3 text-sm"
                    data-delivery-local-quality-target={value.target.id}
                  >
                    <p className="break-all">
                      独立本地评议 · 目标 {value.target.kind}:{value.target.id}{" "}
                      v{value.target.version} · 作者声明覆盖{" "}
                      {value.reviewedDimensions.length}/
                      {value.requiredDimensions.length} 个维度 ·{" "}
                      {value.blockers.length} 项未处理错误 ·{" "}
                      {value.acceptedRiskCount}{" "}
                      项明确接受风险。人工声明未认证；本地规则不提供语义覆盖，不是模型报告。
                    </p>
                    {value.reviews.map((review) => (
                      <Link
                        key={review.id}
                        className="mt-2 block break-all text-link"
                        to={`/projects/${props.projectId}/tools/quality-review?localReviewId=${review.id}`}
                        onClick={props.onClose}
                      >
                        打开实际
                        {review.origin === "human-declared"
                          ? "人工声明"
                          : "本地规则"}{" "}
                        {review.id} · v{review.version}
                      </Link>
                    ))}
                  </div>
                ))}
                {preview.manifest.preflight.blockers.map((item) => (
                  <InlineNotice tone="danger" key={item}>
                    {item}
                  </InlineNotice>
                ))}
                <p className="text-sm">
                  费用：未知（不是零）。{preview.manifest.costs.explanation}
                </p>
              </section>
              <section className="space-y-1 text-sm">
                <h3 className="font-medium">缺失项与外部依赖</h3>
                {[
                  ...preview.manifest.missingItems,
                  ...preview.manifest.externalDependencies,
                ].map((item, index) => (
                  <p key={index}>{item}</p>
                ))}
              </section>
              <label className="grid gap-1 text-sm">
                查看实际文件
                <Select
                  value={selectedFile?.fileName ?? ""}
                  onValueChange={setFileName}
                  options={preview.files.map((file) => ({
                    value: file.fileName,
                    label: `${file.fileName} · ${file.byteSize} 字节`,
                  }))}
                />
              </label>
              {selectedFile && (
                <>
                  <p className="break-all text-xs text-muted">
                    文件 SHA-256：{selectedFile.sha256}
                  </p>
                  <pre
                    className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded border border-line p-3 text-xs"
                    aria-label="实际试制文件内容"
                  >
                    {selectedFile.content}
                  </pre>
                </>
              )}
              {preview.status === "awaiting-confirmation" && (
                <fieldset disabled={working} className="space-y-3">
                  <legend className="font-medium text-sm">
                    明确确认用途与权利
                  </legend>
                  <label className="grid gap-1 text-sm">
                    权利依据
                    <Select
                      value={basis}
                      onValueChange={(value) => setBasis(value as typeof basis)}
                      options={[
                        {
                          value: "original",
                          label: "本人原创 / 由本人负责的作者稿",
                        },
                        {
                          value: "authorized",
                          label: "已取得本次导出范围的授权",
                        },
                        {
                          value: "public-domain",
                          label: "已核对公版来源与适用范围",
                        },
                      ]}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    权利范围说明
                    <Textarea
                      value={note}
                      maxLength={2000}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="说明来源、用途与限制；声明不替代授权证明核验。"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rightsConfirmed}
                      onChange={(event) =>
                        setRightsConfirmed(event.target.checked)
                      }
                    />
                    我确认这些正式版本，并有权导出这份试制包
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={internalConfirmed}
                      onChange={(event) =>
                        setInternalConfirmed(event.target.checked)
                      }
                    />
                    我确认此包仅用于内部试制审阅，不作为发行就绪证明
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={unknownConfirmed}
                      onChange={(event) =>
                        setUnknownConfirmed(event.target.checked)
                      }
                    />
                    我已知悉质量、授权范围、费用与上述缺失项尚未全部核验
                  </label>
                  <Button
                    disabled={
                      working ||
                      !canSave ||
                      !rightsConfirmed ||
                      !internalConfirmed ||
                      !unknownConfirmed
                    }
                    onClick={() => void save()}
                  >
                    {working ? "正在保存…" : "确认并保存 ZIP 试制包"}
                  </Button>
                </fieldset>
              )}
              {preview.status === "saved" && (
                <InlineNotice tone="success">
                  试制包已保存并核验。{preview.receipt?.savedAt} ·{" "}
                  {preview.receipt?.byteSize}{" "}
                  字节。回执只证明当时保存成功，不监控文件之后的移动、修改或删除。
                </InlineNotice>
              )}
              {preview.status === "saving" && (
                <InlineNotice tone="warning">
                  尚无完成回执。可读取同一记录核对，不自动重开保存窗口；中断后也不推定已交付。
                </InlineNotice>
              )}
              {preview.status === "canceled" && (
                <InlineNotice tone="warning">
                  已取消保存，未记录成功交付。再次保存须从正式分镜重新预览。
                </InlineNotice>
              )}
              {preview.status === "failed" && (
                <InlineNotice tone="danger">
                  保存失败或回执未匹配，不能记录已交付；外部文件可能存在，请先核对。
                </InlineNotice>
              )}
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => void reload()}
              >
                刷新同一交付记录
              </Button>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            disabled={working}
            onClick={props.onClose}
          >
            关闭
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
