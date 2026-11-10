import { useEffect, useState } from "react";
import { useQuery } from "../../query";
import { Link } from "../../router";
import {
  Button,
  Dialog,
  InlineNotice,
  Select,
  Textarea,
  NativeSelect,
} from "@dramaip/infra-ui-primitives";
import type { PilotPackagePreview } from "@dramaip/contracts/delivery";
import { message, useStudio } from "../../studio-shared";
import { readAllShotAttributionSummaries } from "../../storyboard-attribution-draft";
import { matchesExactPilotPackage } from "../../episode-development-navigation";
import styles from "./PilotPackageDialog.module.css";
import { copyText } from "../../copy";

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
        className={styles.c1}
        aria-label={copyText("app/features/production/PilotPackageDialog.1")}
        closeLabel="关闭试制预览"
      >
        <Dialog.Title>
          {copyText("app/features/production/PilotPackageDialog.2")}
        </Dialog.Title>
        <Dialog.Description>
          {copyText("app/features/production/PilotPackageDialog.3")}
        </Dialog.Description>
        <div className={styles.c2}>
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {error && preview && (
            <InlineNotice tone="warning">
              {copyText("app/features/production/PilotPackageDialog.4")}
            </InlineNotice>
          )}
          {!preview ? (
            <>
              {props.storyboard && (
                <p className={styles.c3}>
                  {copyText("app/features/production/PilotPackageDialog.5")}
                  {props.storyboard.id}
                  {copyText("app/features/production/PilotPackageDialog.6")}
                  {props.storyboard.version}
                </p>
              )}
              <label className={styles.c4}>
                <input
                  type="checkbox"
                  checked={includeNle}
                  disabled={working}
                  onChange={(event) => setIncludeNle(event.target.checked)}
                />
                {copyText("app/features/production/PilotPackageDialog.7")}
              </label>
              <label className={styles.c4}>
                <input
                  type="checkbox"
                  checked={includeWorkflowLineage}
                  disabled={working}
                  onChange={(event) =>
                    setIncludeWorkflowLineage(event.target.checked)
                  }
                />
                {copyText("app/features/production/PilotPackageDialog.8")}
              </label>
              <label className={styles.c5}>
                {copyText("app/features/production/PilotPackageDialog.9")}
                <NativeSelect
                  aria-label={copyText(
                    "app/features/production/PilotPackageDialog.10",
                  )}
                  className={styles.c6}
                  value={shotAttributionId}
                  disabled={working}
                  onChange={(event) => setShotAttributionId(event.target.value)}
                >
                  <option value="">
                    {copyText("app/features/production/PilotPackageDialog.11")}
                  </option>
                  {shotAttributionId && !selectedAttribution && (
                    <option value={shotAttributionId}>
                      {copyText(
                        "app/features/production/PilotPackageDialog.12",
                      )}
                      {shotAttributionId}
                    </option>
                  )}
                  {eligibleAttributions.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.id}
                      {copyText(
                        "app/features/production/PilotPackageDialog.13",
                      )}
                      {value.version} · {value.coverage.associatedShots}/
                      {value.coverage.totalShots}
                      {copyText(
                        "app/features/production/PilotPackageDialog.14",
                      )}{" "}
                      {value.coverage.nodeAssociatedShots}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <p className={styles.c7}>
                {copyText("app/features/production/PilotPackageDialog.15")}
              </p>
              {attributions.isError && (
                <InlineNotice tone="warning">
                  {copyText("app/features/production/PilotPackageDialog.16")}
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
                {copyText("app/features/production/PilotPackageDialog.17")}
              </Button>
            </>
          ) : (
            <>
              <p className={styles.c8}>
                {preview.manifest.projectTitle} ·{" "}
                {preview.manifest.episodeTitle} ·{" "}
                {pilotPackageStatusLabel[preview.status]}
              </p>
              <p className={styles.c7}>
                {preview.files.length}
                {copyText("app/features/production/PilotPackageDialog.18")}
                {preview.archive.byteSize}{" "}
                {copyText("app/features/production/PilotPackageDialog.19")}
                {preview.manifest.durationSeconds}
                {copyText("app/features/production/PilotPackageDialog.20")}
              </p>
              <p className={styles.c9}>
                {copyText("app/features/production/PilotPackageDialog.21")}
                {preview.archive.sha256}
              </p>
              <details>
                <summary className={styles.c10}>
                  {copyText("app/features/production/PilotPackageDialog.22")}
                </summary>
                <ul className={styles.c11}>
                  {Object.entries(preview.manifest.adopted).flatMap(
                    ([label, ref]) =>
                      ref && "id" in ref && "version" in ref
                        ? [
                            <li key={label}>
                              {label}：{ref.id}
                              {copyText(
                                "app/features/production/PilotPackageDialog.13",
                              )}
                              {ref.version}
                            </li>,
                          ]
                        : [],
                  )}
                  {preview.manifest.adopted.directSource && (
                    <li>
                      {copyText(
                        "app/features/production/PilotPackageDialog.23",
                      )}
                      {preview.manifest.adopted.directSource.entryPath ===
                      "script"
                        ? "已有剧本"
                        : "作者创意简报"}{" "}
                      {copyText(
                        "app/features/production/PilotPackageDialog.24",
                      )}
                      {preview.manifest.adopted.directSource.project.version}
                      {preview.manifest.adopted.directSource.sourceScript
                        ? ` · 原剧本 v${preview.manifest.adopted.directSource.sourceScript.version}`
                        : ""}
                      {copyText(
                        "app/features/production/PilotPackageDialog.25",
                      )}
                    </li>
                  )}
                </ul>
              </details>
              {preview.sourceState === "stale" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/production/PilotPackageDialog.26")}
                  {preview.sourceIssues.join(" ")}
                </InlineNotice>
              )}
              <section
                className={styles.c12}
                aria-label={copyText(
                  "app/features/production/PilotPackageDialog.27",
                )}
              >
                <h3 className={styles.c8}>
                  {copyText("app/features/production/PilotPackageDialog.28")}
                </h3>
                {preview.manifest.preflight.checks.map((check) => (
                  <p key={check.id} className={styles.c10}>
                    <span className={styles.c13}>
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
                    className={styles.c14}
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
                      {copyText(
                        "app/features/production/PilotPackageDialog.29",
                      )}
                      {value.target.version}
                      {copyText(
                        "app/features/production/PilotPackageDialog.30",
                      )}{" "}
                      {value.reviewedDimensions.length}/
                      {value.requiredDimensions.length}
                      {copyText(
                        "app/features/production/PilotPackageDialog.31",
                      )}{" "}
                      {value.blockers.length}
                      {copyText(
                        "app/features/production/PilotPackageDialog.32",
                      )}{" "}
                      {value.acceptedRiskCount}
                      {copyText(
                        "app/features/production/PilotPackageDialog.33",
                      )}
                    </p>
                    {value.target.sourceFingerprint && (
                      <p
                        className={styles.c9}
                        data-delivery-quality-fingerprint={
                          value.target.sourceFingerprint
                        }
                      >
                        {copyText(
                          "app/features/production/PilotPackageDialog.34",
                        )}
                        {value.target.kind}:{value.target.id}
                        {copyText(
                          "app/features/production/PilotPackageDialog.35",
                        )}{" "}
                        {value.target.sourceFingerprint}
                        {copyText(
                          "app/features/production/PilotPackageDialog.36",
                        )}
                      </p>
                    )}
                    {value.reports.map((report) => (
                      <Link
                        key={report.id}
                        className={styles.c15}
                        to={`/projects/${props.projectId}/tools/quality-review?reportId=${report.id}`}
                        onClick={props.onClose}
                      >
                        {copyText(
                          "app/features/production/PilotPackageDialog.37",
                        )}
                        {report.id}
                        {copyText(
                          "app/features/production/PilotPackageDialog.38",
                        )}
                        {report.version}
                      </Link>
                    ))}
                  </div>
                ))}
                {preview.manifest.localQualityEvidence?.map((value) => (
                  <div
                    key={`local:${value.target.kind}:${value.target.id}`}
                    className={styles.c14}
                    data-delivery-local-quality-target={value.target.id}
                  >
                    <p className={styles.c16}>
                      {copyText(
                        "app/features/production/PilotPackageDialog.39",
                      )}
                      {value.target.kind}:{value.target.id}{" "}
                      {copyText(
                        "app/features/production/PilotPackageDialog.29",
                      )}
                      {value.target.version}
                      {copyText(
                        "app/features/production/PilotPackageDialog.40",
                      )}{" "}
                      {value.reviewedDimensions.length}/
                      {value.requiredDimensions.length}
                      {copyText(
                        "app/features/production/PilotPackageDialog.31",
                      )}{" "}
                      {value.blockers.length}
                      {copyText(
                        "app/features/production/PilotPackageDialog.32",
                      )}{" "}
                      {value.acceptedRiskCount}{" "}
                      {copyText(
                        "app/features/production/PilotPackageDialog.41",
                      )}
                    </p>
                    {value.reviews.map((review) => (
                      <Link
                        key={review.id}
                        className={styles.c15}
                        to={`/projects/${props.projectId}/tools/quality-review?localReviewId=${review.id}`}
                        onClick={props.onClose}
                      >
                        {copyText(
                          "app/features/production/PilotPackageDialog.42",
                        )}
                        {review.origin === "human-declared"
                          ? "人工声明"
                          : "本地规则"}{" "}
                        {review.id}
                        {copyText(
                          "app/features/production/PilotPackageDialog.6",
                        )}
                        {review.version}
                      </Link>
                    ))}
                  </div>
                ))}
                {preview.manifest.preflight.blockers.map((item) => (
                  <InlineNotice tone="danger" key={item}>
                    {item}
                  </InlineNotice>
                ))}
                <p className={styles.c10}>
                  {copyText("app/features/production/PilotPackageDialog.43")}
                  {preview.manifest.costs.explanation}
                </p>
              </section>
              <section className={styles.c17}>
                <h3 className={styles.c13}>
                  {copyText("app/features/production/PilotPackageDialog.44")}
                </h3>
                {[
                  ...preview.manifest.missingItems,
                  ...preview.manifest.externalDependencies,
                ].map((item, index) => (
                  <p key={index}>{item}</p>
                ))}
              </section>
              <label className={styles.c18}>
                {copyText("app/features/production/PilotPackageDialog.45")}
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
                  <p className={styles.c9}>
                    {copyText("app/features/production/PilotPackageDialog.46")}
                    {selectedFile.sha256}
                  </p>
                  <pre
                    className={styles.c19}
                    aria-label={copyText(
                      "app/features/production/PilotPackageDialog.47",
                    )}
                  >
                    {selectedFile.content}
                  </pre>
                </>
              )}
              {preview.status === "awaiting-confirmation" && (
                <fieldset disabled={working} className={styles.c20}>
                  <legend className={styles.c8}>
                    {copyText("app/features/production/PilotPackageDialog.48")}
                  </legend>
                  <label className={styles.c18}>
                    {copyText("app/features/production/PilotPackageDialog.49")}
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
                  <label className={styles.c18}>
                    {copyText("app/features/production/PilotPackageDialog.50")}
                    <Textarea
                      value={note}
                      maxLength={2000}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={copyText(
                        "app/features/production/PilotPackageDialog.51",
                      )}
                    />
                  </label>
                  <label className={styles.c4}>
                    <input
                      type="checkbox"
                      checked={rightsConfirmed}
                      onChange={(event) =>
                        setRightsConfirmed(event.target.checked)
                      }
                    />
                    {copyText("app/features/production/PilotPackageDialog.52")}
                  </label>
                  <label className={styles.c4}>
                    <input
                      type="checkbox"
                      checked={internalConfirmed}
                      onChange={(event) =>
                        setInternalConfirmed(event.target.checked)
                      }
                    />
                    {copyText("app/features/production/PilotPackageDialog.53")}
                  </label>
                  <label className={styles.c4}>
                    <input
                      type="checkbox"
                      checked={unknownConfirmed}
                      onChange={(event) =>
                        setUnknownConfirmed(event.target.checked)
                      }
                    />
                    {copyText("app/features/production/PilotPackageDialog.54")}
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
                  {copyText("app/features/production/PilotPackageDialog.55")}
                  {preview.receipt?.savedAt} · {preview.receipt?.byteSize}{" "}
                  {copyText("app/features/production/PilotPackageDialog.56")}
                </InlineNotice>
              )}
              {preview.status === "saving" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/production/PilotPackageDialog.57")}
                </InlineNotice>
              )}
              {preview.status === "canceled" && (
                <InlineNotice tone="warning">
                  {copyText("app/features/production/PilotPackageDialog.58")}
                </InlineNotice>
              )}
              {preview.status === "failed" && (
                <InlineNotice tone="danger">
                  {copyText("app/features/production/PilotPackageDialog.59")}
                </InlineNotice>
              )}
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => void reload()}
              >
                {copyText("app/features/production/PilotPackageDialog.60")}
              </Button>
            </>
          )}
        </div>
        <div className={styles.c21}>
          <Button
            variant="secondary"
            disabled={working}
            onClick={props.onClose}
          >
            {copyText("app/features/production/PilotPackageDialog.61")}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
