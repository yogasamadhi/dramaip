import { useEffect, useState, type ReactNode } from "react";
import type { ChangePreviewFactoryProps } from "@dramaip/automation-automation-client/client/contract";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  PropsRenderFactories,
  TranslateNS,
} from "@dramaip/infra-ui-slots";
import type {
  CloudConnectionResult,
  EditorCreatePackageResult,
  EditorCreateRevisionPreviewResult,
  EditorListCommentsResult,
  EditorListDecisionsResult,
  EditorListPackagesResult,
  EditorPreflightResult,
  EditorTimelineResult,
} from "@dramaip/production-review/types";
import type {
  SystemCredentialCaptureInput,
  SystemCredentialStatus,
  SystemFileGrant,
} from "@dramaip/system-system/types";
import clsx from "clsx";
import {
  messageOf,
  saveDocument,
  value,
  type ProductionRemote,
  type ReviewRemote,
  type SystemRemote,
  type TextDocument,
  type TimelineRemote,
} from "../remote.ts";
import type {
  CloudBinding,
  CloudDeleted,
  CloudPreview,
  CloudPublished,
  CloudSynced,
  OfflineImport,
} from "./answers.ts";
import { MediaReview } from "./MediaReview.tsx";
import css from "./Stages.module.css";
import { useLoad } from "./use-load.ts";

type Translate = TranslateNS<"review">;
type Decision = "approve" | "return" | "request_changes" | "note";
type TimelineFormat = "manifest" | "edl" | "fcpxml" | "srt";

/** Props of the review stage of one episode. */
export interface ReviewEditorProps extends PropsRenderFactories {
  projectId: string;
  episodeId: string;
  review: ReviewRemote;
  timeline: TimelineRemote;
  production: ProductionRemote;
  system: SystemRemote;
  t: Translate;
}

/** One media file chosen for a cloud review, before any upload. */
interface CloudMedia {
  id: string;
  shotId: string;
  relativePath: string;
  mimeType: string;
  capabilityToken: string;
  name: string;
}

const TIMELINE_FORMATS = ["manifest", "edl", "fcpxml", "srt"] as const;
const DECISIONS = ["note", "approve", "return", "request_changes"] as const;
const CLOUD_EXTENSIONS = [
  "mp4",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "mp3",
  "wav",
  "vtt",
];
const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};
const mimeOf = (name: string) =>
  MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "text/vtt";

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));

/**
 * Open the shell's own capture window and wait for the stored credential's
 * reference; the secret never reaches this page.
 */
async function captureCredential(
  system: SystemRemote,
  input: SystemCredentialCaptureInput,
  copy: { cancelled: string; expired: string },
): Promise<string> {
  const session = await value<{ captureSessionId: string; expiresAt: string }>(
    system.createCredentialCaptureSession(input),
  );
  while (Date.parse(session.expiresAt) > Date.now()) {
    const current = await value<{ status: string; credentialRef?: string }>(
      system.credentialSession(session.captureSessionId),
    );
    if (current.status === "completed" && current.credentialRef)
      return current.credentialRef;
    if (current.status !== "pending") throw new Error(copy.cancelled);
    await pause();
  }
  throw new Error(copy.expired);
}

/**
 * The review stage of one episode: the whole-package media review, the
 * relinkable editing timeline and its exchange files, offline review
 * packages with their comments and decisions, the optional cloud review,
 * and a script revision drawn from unresolved feedback. The timeline never
 * exposes a path, copies media or poses as a finished cut; nothing reaches
 * the cloud but the media the author picks, and the token stays in the
 * local vault.
 */
export function ReviewEditor(props: ReviewEditorProps) {
  const { projectId, episodeId, review, system, t } = props;
  const [packageId, setPackageId] = useState("");
  const [shotId, setShotId] = useState("");
  const [authorAlias, setAuthorAlias] = useState("");
  const [timecode, setTimecode] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [decision, setDecision] = useState<Decision>("note");
  const [decisionNote, setDecisionNote] = useState("");
  const [cloudBaseUrl, setCloudBaseUrl] = useState("");
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState("");
  const [cloudPin, setCloudPin] = useState("");
  const [cloudMedia, setCloudMedia] = useState<CloudMedia[]>([]);
  const [cloudShareUrl, setCloudShareUrl] = useState<string>();
  const [cloudPreview, setCloudPreview] = useState<CloudPreview>();
  const [cloudPreviewKey, setCloudPreviewKey] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [revisionContent, setRevisionContent] = useState("");
  const [revisionPreview, setRevisionPreview] =
    useState<EditorCreateRevisionPreviewResult>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState<string>();
  const timeline = useLoad(episodeId, () =>
    value<EditorTimelineResult>(review.editorTimeline(episodeId)),
  );
  const preflight = useLoad(episodeId, () =>
    value<EditorPreflightResult>(review.editorPreflight(episodeId)),
  );
  const packages = useLoad(episodeId, () =>
    value<EditorListPackagesResult>(review.editorListPackages(episodeId)),
  );
  const packageList = packages.data ?? [];
  const selected = packageList.find((item) => item.id === packageId);
  const scripts = useLoad(
    selected ? `${selected.projectId}:${episodeId}` : undefined,
    () =>
      value<Array<{ id: string; title: string; version: number }>>(
        props.production.scriptsList({
          projectId: selected?.projectId ?? "",
          parentId: episodeId,
        }),
      ),
  );
  const scriptList = scripts.data ?? [];
  const connection = useLoad("connection", () =>
    value<CloudConnectionResult>(review.cloudConnection()),
  );
  // A package the platform has never bound answers with a failure: none.
  const binding = useLoad(packageId || undefined, () =>
    value<CloudBinding>(review.cloudBinding(packageId)),
  );
  const cloudBinding = binding.error === undefined ? binding.data : undefined;
  const vault = useLoad("vault", () =>
    value<SystemCredentialStatus>(system.credentialStatus()),
  );
  const comments = useLoad(packageId || undefined, () =>
    value<EditorListCommentsResult>(review.editorListComments(packageId)),
  );
  const decisions = useLoad(packageId || undefined, () =>
    value<EditorListDecisionsResult>(review.editorListDecisions(packageId)),
  );
  const commentList = packageId ? (comments.data ?? []) : [];
  const decisionList = packageId ? (decisions.data ?? []) : [];
  const configured = connection.data?.configured === true;
  useEffect(() => {
    const current = connection.data;
    if (!current?.configured) return;
    setCloudBaseUrl((value) => value || current.baseUrl);
    setCloudWorkspaceId((value) => value || current.workspaceId);
  }, [connection.data]);
  useEffect(() => {
    if (packageId && packages.data && !selected) setPackageId("");
  }, [packageId, packages.data, selected]);
  useEffect(() => {
    if (!scripts.data) return;
    if (scriptId && !scripts.data.some((item) => item.id === scriptId))
      setScriptId("");
    else if (!scriptId && scripts.data[0]) setScriptId(scripts.data[0].id);
  }, [scriptId, scripts.data]);
  useEffect(() => {
    setRevisionPreview(undefined);
  }, [packageId]);
  const selectionKey = JSON.stringify({
    packageId,
    media: cloudMedia.map(({ name: _name, ...item }) => item),
  });
  const currentPreview =
    cloudPreviewKey === selectionKey ? cloudPreview : undefined;
  const refresh = async () => {
    await Promise.all([
      packages.reload(),
      comments.reload(),
      decisions.reload(),
    ]);
  };
  /** Run one step; its failure becomes the notice. */
  const run = async (name: string, work: () => Promise<void>) => {
    setWorking(name);
    setNotice(undefined);
    try {
      await work();
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(undefined);
    }
  };
  const save = async (document: TextDocument, saved: string) =>
    setNotice(
      (await saveDocument(system, document)) ? saved : t("notice.cancelled"),
    );
  const exportTimeline = (format: TimelineFormat) =>
    run(`timeline-${format}`, async () => {
      const document = await value<TextDocument>(
        props.timeline.exportDelivery(episodeId, format),
      );
      await save(document, t("editor.timeline.exported"));
    });
  const createPackage = () =>
    run("create", async () => {
      const created = await value<EditorCreatePackageResult>(
        review.editorCreatePackage(episodeId, undefined, undefined),
      );
      setNotice(t("editor.notice.created"));
      await refresh();
      setPackageId(created.id);
    });
  const exportPackage = () =>
    packageId
      ? run("export", async () => {
          const document = await value<TextDocument>(
            review.editorExportPackage(packageId),
          );
          await save(document, t("editor.notice.exported"));
        })
      : undefined;
  const importOffline = () =>
    packageId
      ? run("import", async () => {
          const files = await value<SystemFileGrant[] | null>(
            system.pickFiles({ multiple: false, extensions: ["json"] }),
          );
          const file = files?.[0];
          if (!file) return;
          const result = await value<OfflineImport>(
            review.editorImportOffline(
              packageId,
              { capabilityToken: file.grantId },
              undefined,
              undefined,
            ),
          );
          setNotice(
            t("editor.notice.imported", {
              comments: result.commentCount,
              decisions: result.decisionCount,
            }),
          );
          await refresh();
        })
      : undefined;
  const chooseCloudMedia = async () => {
    try {
      const files = await value<SystemFileGrant[] | null>(
        system.pickFiles({ multiple: true, extensions: CLOUD_EXTENSIONS }),
      );
      if (!files?.length) return;
      const clips = timeline.data?.clips ?? [];
      setCloudMedia(
        files.map((file, index) => ({
          id: `cloud-${Date.now()}-${index}`,
          shotId: clips[index]?.shotId ?? "",
          relativePath: `review/${file.displayName.replace(/[\\/]/g, "-")}`,
          mimeType: mimeOf(file.displayName),
          capabilityToken: file.grantId,
          name: file.displayName,
        })),
      );
    } catch (cause) {
      setNotice(messageOf(cause));
    }
  };
  const saveConnection = async () => {
    if (!cloudBaseUrl.trim() || !cloudWorkspaceId.trim()) {
      setNotice(t("cloud.notice.incomplete"));
      return;
    }
    if (vault.data?.available !== true) {
      setNotice(t("cloud.notice.vault"));
      return;
    }
    let credentialRef: string | undefined;
    await run("connection", async () => {
      try {
        credentialRef = await captureCredential(
          system,
          {
            purpose: "cloud-review",
            label: t("cloud.credential.label"),
            policyId: "review.cloud.v1",
            allowedOrigin: new URL(cloudBaseUrl.trim()).origin,
          },
          {
            cancelled: t("cloud.credential.cancelled"),
            expired: t("cloud.credential.expired"),
          },
        );
        await value(
          review.cloudSaveConnection(
            {
              baseUrl: cloudBaseUrl.trim(),
              workspaceId: cloudWorkspaceId.trim(),
              credentialRef,
            },
            undefined,
            undefined,
          ),
        );
      } catch (cause) {
        // A stored token the connection never took is removed again.
        if (credentialRef)
          await system.removeCredential(credentialRef).catch(() => undefined);
        throw cause;
      }
      await connection.reload();
      setNotice(t("cloud.notice.saved"));
    });
  };
  /** Whether the chosen package, connection and media allow a cloud step. */
  const cloudReady = () => {
    if (!packageId || !configured || !cloudMedia.length) {
      setNotice(t("cloud.notice.selectFirst"));
      return false;
    }
    if (cloudMedia.some((item) => !item.shotId)) {
      setNotice(t("cloud.notice.shotRequired"));
      return false;
    }
    return true;
  };
  const media = () => cloudMedia.map(({ name: _name, ...item }) => item);
  const previewCloud = () => {
    if (!cloudReady()) return;
    void run("preview", async () => {
      const preview = await value<CloudPreview>(
        review.cloudPreview(
          packageId,
          { media: media() },
          undefined,
          undefined,
        ),
      );
      setCloudPreview(preview);
      setCloudPreviewKey(selectionKey);
      setNotice(t("cloud.notice.previewed"));
    });
  };
  const publishCloud = () => {
    if (!cloudReady()) return;
    if (!currentPreview) {
      setNotice(t("cloud.notice.previewFirst"));
      return;
    }
    void run("publish", async () => {
      const published = await value<CloudPublished>(
        review.cloudPublish(
          packageId,
          {
            ...(cloudPin.trim() ? { pin: cloudPin.trim() } : {}),
            media: media(),
          },
          undefined,
          undefined,
        ),
      );
      setCloudPin("");
      setCloudShareUrl(published.shareUrl);
      setNotice(t("cloud.notice.published", { at: published.expiresAt }));
      await binding.reload();
    });
  };
  const syncCloud = () =>
    packageId
      ? run("sync", async () => {
          const synced = await value<CloudSynced>(
            review.cloudSync(packageId, undefined, undefined),
          );
          setNotice(
            t("cloud.notice.synced", {
              comments: synced.commentCount,
              decisions: synced.decisionCount,
            }),
          );
          await refresh();
        })
      : undefined;
  const deleteCloud = () =>
    packageId && cloudBinding
      ? run("delete", async () => {
          const deleted = await value<CloudDeleted>(
            review.cloudDelete(packageId, undefined, undefined),
          );
          setCloudShareUrl(undefined);
          setCloudMedia([]);
          setNotice(
            t(
              deleted.localFeedbackPreserved
                ? "cloud.notice.deletedKept"
                : "cloud.notice.deleted",
            ),
          );
          await binding.reload();
        })
      : undefined;
  const createRevisionPreview = () => {
    if (!packageId || !scriptId || !revisionContent.trim()) {
      setNotice(t("editor.notice.revisionIncomplete"));
      return;
    }
    void run("revision", async () => {
      const preview = await value<EditorCreateRevisionPreviewResult>(
        review.editorCreateRevisionPreview(
          packageId,
          { scriptId, proposedContent: revisionContent.trim() },
          undefined,
          undefined,
        ),
      );
      setRevisionPreview(preview);
      setNotice(t("editor.notice.revisionCreated"));
    });
  };
  const createComment = () => {
    if (!packageId || !commentBody.trim()) {
      setNotice(t("editor.notice.commentIncomplete"));
      return;
    }
    const seconds = Number(timecode);
    void run("comment", async () => {
      await value(
        review.editorCreateComment(
          packageId,
          {
            ...(shotId ? { shotId } : {}),
            ...(Number.isFinite(seconds) && seconds >= 0
              ? { timecodeSeconds: seconds }
              : {}),
            ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
            body: commentBody.trim(),
          },
          undefined,
          undefined,
        ),
      );
      setCommentBody("");
      setNotice(t("editor.notice.commentSaved"));
      await refresh();
    });
  };
  const createDecision = () => {
    if (!packageId) {
      setNotice(t("editor.notice.packageFirst"));
      return;
    }
    void run("decision", async () => {
      await value(
        review.editorCreateDecision(
          packageId,
          {
            ...(shotId ? { shotId } : {}),
            decision,
            ...(authorAlias.trim() ? { authorAlias: authorAlias.trim() } : {}),
            ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
          },
          undefined,
          undefined,
        ),
      );
      setDecisionNote("");
      setNotice(t("editor.notice.decisionSaved"));
      await refresh();
    });
  };
  const resolveComment = (id: string, resolved: boolean) => {
    setWorking(`resolve-${id}`);
    value(review.editorResolveComment(id, { resolved }, undefined, undefined))
      .then(refresh)
      .catch((cause: unknown) => setNotice(messageOf(cause)))
      .finally(() => setWorking(undefined));
  };
  const busy = working !== undefined;
  const clips = timeline.data?.clips ?? [];
  const revisable =
    Boolean(packageId) &&
    (commentList.some((item) => !item.resolved) ||
      decisionList.some(
        (item) =>
          item.decision === "return" || item.decision === "request_changes",
      ));
  const field = (label: string, control: ReactNode, wide = false) => (
    <label className={clsx(css.field, wide && css.wide)}>
      {label}
      {control}
    </label>
  );
  return (
    <section className={css.panel}>
      <div>
        <p className={css.eyebrow}>{t("editor.eyebrow")}</p>
        <h2 className={css.title}>{t("editor.title")}</h2>
        <p className={css.muted}>{t("editor.description")}</p>
      </div>
      <MediaReview
        key={`${projectId}:${episodeId}`}
        projectId={projectId}
        episodeId={episodeId}
        packageId={packageId}
        onCreated={(id) => {
          void refresh().then(() => setPackageId(id));
        }}
        review={review}
        system={system}
        renderFactorySlot={props.renderFactorySlot}
        t={t}
      />
      {timeline.error !== undefined && (
        <p className={clsx(css.notice, css.danger)}>
          {messageOf(timeline.error)}
        </p>
      )}
      {timeline.data && (
        <section className={clsx(css.box, css.sunken)}>
          <div className={clsx(css.row, css.between)}>
            <div>
              <h3 className={css.heading}>{timeline.data.title}</h3>
              <p className={css.muted}>
                {t("editor.timeline.meta", {
                  count: clips.length,
                  width: timeline.data.width,
                  height: timeline.data.height,
                  rate: timeline.data.frameRate,
                })}
              </p>
            </div>
            <div className={css.row}>
              {TIMELINE_FORMATS.map((format) => (
                <Button
                  key={format}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void exportTimeline(format)}
                >
                  {t(
                    working === `timeline-${format}`
                      ? "busy.exporting"
                      : `editor.timeline.${format}`,
                  )}
                </Button>
              ))}
            </div>
          </div>
          {preflight.data && (
            <div className={css.item}>
              <p>
                {t("editor.preflight.counts", {
                  state: t(
                    preflight.data.canExport
                      ? "editor.preflight.ok"
                      : "editor.preflight.blocked",
                  ),
                  referenced: preflight.data.referencedClipCount,
                  relink: preflight.data.relinkRequiredCount,
                })}
              </p>
              {preflight.data.blockers.length > 0 && (
                <p className={css.danger}>
                  {preflight.data.blockers.join("；")}
                </p>
              )}
              {preflight.data.warnings.map((item) => (
                <p key={item} className={clsx(css.muted, css.small)}>
                  {item}
                </p>
              ))}
            </div>
          )}
          {clips.map((clip) => (
            <div key={clip.id} className={css.item}>
              <p>
                <span className={css.heading}>
                  {t("editor.clip.name", {
                    index: clip.orderIndex + 1,
                    name: clip.name,
                  })}
                </span>{" "}
                <span className={css.muted}>
                  {t("editor.clip.span", {
                    start: clip.startSeconds.toFixed(1),
                    end: (clip.startSeconds + clip.durationSeconds).toFixed(1),
                    state: t(
                      clip.mediaStatus === "referenced"
                        ? "editor.clip.referenced"
                        : "editor.clip.relink",
                    ),
                  })}
                </span>
              </p>
              {clip.subtitle && (
                <p className={clsx(css.muted, css.small)}>
                  {t("editor.clip.subtitle", { text: clip.subtitle })}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className={css.box}>
        <div className={clsx(css.row, css.between)}>
          <div>
            <h3 className={css.heading}>{t("editor.packages.title")}</h3>
            <p className={css.muted}>{t("editor.packages.description")}</p>
          </div>
          <div className={css.row}>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void createPackage()}
            >
              {t(
                working === "create"
                  ? "busy.creating"
                  : "editor.package.create",
              )}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !packageId}
              onClick={() => void exportPackage()}
            >
              {t(
                working === "export"
                  ? "busy.exporting"
                  : "editor.package.export",
              )}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !packageId}
              onClick={() => void importOffline()}
            >
              {t(
                working === "import"
                  ? "editor.package.importing"
                  : "editor.package.import",
              )}
            </Button>
          </div>
        </div>
        {field(
          t("editor.package.current"),
          <select
            aria-label={t("editor.package.current")}
            className={css.select}
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            <option value="">{t("editor.package.none")}</option>
            {packageList.map((item) => (
              <option key={item.id} value={item.id}>
                {t("editor.package.option", {
                  title: item.title,
                  at: item.createdAt,
                })}
              </option>
            ))}
          </select>,
        )}
      </section>
      <section className={css.box}>
        <div className={clsx(css.row, css.between)}>
          <div>
            <h3 className={css.heading}>{t("cloud.title")}</h3>
            <p className={css.muted}>{t("cloud.description")}</p>
          </div>
          <span className={clsx(css.badge)}>
            {t(configured ? "cloud.configured" : "cloud.unconfigured")}
          </span>
        </div>
        <div className={css.grid}>
          {field(
            t("cloud.baseUrl"),
            <input
              className={css.input}
              value={cloudBaseUrl}
              placeholder={t("cloud.baseUrl.placeholder")}
              onChange={(event) => setCloudBaseUrl(event.target.value)}
            />,
          )}
          {field(
            t("cloud.workspace"),
            <input
              className={css.input}
              value={cloudWorkspaceId}
              placeholder={t("cloud.workspace.placeholder")}
              onChange={(event) => setCloudWorkspaceId(event.target.value)}
            />,
          )}
          <div className={css.item}>
            <p className={css.heading}>{t("cloud.token")}</p>
            <p className={clsx(css.muted, css.small)}>
              {t("cloud.token.hint")}
            </p>
          </div>
          {field(
            t("cloud.pin"),
            <input
              className={css.input}
              type="password"
              inputMode="numeric"
              value={cloudPin}
              placeholder={t("cloud.pin.placeholder")}
              onChange={(event) => setCloudPin(event.target.value)}
            />,
          )}
        </div>
        <div className={css.row}>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || vault.data?.available !== true}
            onClick={() => void saveConnection()}
          >
            {t(working === "connection" ? "busy.saving" : "cloud.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void chooseCloudMedia()}
          >
            {t("cloud.media.choose")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !packageId || !configured || !cloudMedia.length}
            onClick={previewCloud}
          >
            {t(working === "preview" ? "cloud.preview.busy" : "cloud.preview")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={
              busy ||
              !packageId ||
              !configured ||
              !cloudMedia.length ||
              !currentPreview
            }
            onClick={publishCloud}
          >
            {t(working === "publish" ? "cloud.publish.busy" : "cloud.publish")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !packageId || !configured}
            onClick={() => void syncCloud()}
          >
            {t(working === "sync" ? "cloud.sync.busy" : "cloud.sync")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !cloudBinding}
            onClick={() => void deleteCloud()}
          >
            {t(working === "delete" ? "cloud.delete.busy" : "cloud.delete")}
          </Button>
        </div>
        {vault.data?.available === false && (
          <p className={clsx(css.small, css.danger)}>
            {vault.data.message ?? t("cloud.vault.unavailable")}
          </p>
        )}
        {cloudMedia.length > 0 && (
          <div className={clsx(css.box, css.sunken)}>
            <p className={css.heading}>{t("cloud.media.title")}</p>
            {cloudMedia.map((item) => (
              <div key={item.id} className={css.grid}>
                <span className={css.break}>
                  {t("cloud.media.item", {
                    name: item.name,
                    mime: item.mimeType,
                    path: item.relativePath,
                  })}
                </span>
                <select
                  aria-label={t("cloud.media.shot.label", { name: item.name })}
                  className={css.select}
                  value={item.shotId}
                  onChange={(event) =>
                    setCloudMedia((current) =>
                      current.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, shotId: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                >
                  <option value="">{t("cloud.media.shot")}</option>
                  {clips.map((clip) => (
                    <option key={clip.shotId} value={clip.shotId}>
                      {t("editor.clip.name", {
                        index: clip.orderIndex + 1,
                        name: clip.name,
                      })}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {currentPreview && (
          <div className={clsx(css.box, css.chosen)}>
            <p className={css.heading}>{t("cloud.preview.title")}</p>
            <p>
              {t("cloud.preview.storage", {
                workspace: currentPreview.workspaceId,
                used: currentPreview.storageBytes,
                max: currentPreview.maxStorageBytes,
              })}
            </p>
            <p className={css.muted}>
              {t("cloud.preview.retention", {
                retention: currentPreview.retention,
              })}
            </p>
            <p className={css.muted}>
              {t("cloud.preview.cost", { cost: currentPreview.costEstimate })}
            </p>
            {currentPreview.media.map((item) => (
              <p key={item.id} className={clsx(css.item, css.small, css.break)}>
                {t("cloud.preview.media", {
                  path: item.relativePath,
                  size: item.sizeBytes,
                  sha: item.sha256,
                })}
              </p>
            ))}
            <details className={css.small}>
              <summary className={css.summary}>
                {t("cloud.preview.manifest")}
              </summary>
              <pre className={css.code}>{currentPreview.manifestJson}</pre>
            </details>
          </div>
        )}
        {cloudPreview && !currentPreview && (
          <p className={clsx(css.small, css.warning)}>
            {t("cloud.preview.stale")}
          </p>
        )}
        {(cloudShareUrl ?? cloudBinding?.shareUrl) && (
          <p className={clsx(css.notice, css.break)}>
            {t("cloud.share", { url: cloudShareUrl ?? cloudBinding?.shareUrl })}
            {cloudBinding &&
              t("cloud.share.binding", {
                status: cloudBinding.status,
                at: cloudBinding.expiresAt,
              })}
          </p>
        )}
      </section>
      {revisable && (
        <section className={clsx(css.box, css.chosen)}>
          <h3 className={css.heading}>{t("editor.revision.title")}</h3>
          <p className={css.muted}>{t("editor.revision.description")}</p>
          {field(
            t("editor.revision.script"),
            <select
              className={css.select}
              value={scriptId}
              onChange={(event) => setScriptId(event.target.value)}
            >
              <option value="">{t("editor.revision.script.none")}</option>
              {scriptList.map((script) => (
                <option key={script.id} value={script.id}>
                  {t("editor.revision.script.option", {
                    title: script.title,
                    version: script.version,
                  })}
                </option>
              ))}
            </select>,
          )}
          {selected &&
            scriptId &&
            props.renderFactorySlot("automation.creation-record", {
              projectId: selected.projectId,
              targetId: scriptId,
              domain: "scripts",
              operation: "script-revision",
              reviewPackageId: packageId,
              defaultInstruction: t("editor.revision.instruction"),
              onApplied: refresh,
            })}
          <details>
            <summary className={css.summary}>
              {t("editor.revision.import")}
            </summary>
            <div className={css.field}>
              {field(
                t("editor.revision.draft"),
                <textarea
                  className={css.textarea}
                  value={revisionContent}
                  placeholder={t("editor.revision.draft.placeholder")}
                  onChange={(event) => setRevisionContent(event.target.value)}
                />,
              )}
              <div>
                <Button
                  variant="outline"
                  disabled={busy || !scriptId || !revisionContent.trim()}
                  onClick={createRevisionPreview}
                >
                  {t(
                    working === "revision"
                      ? "busy.creating"
                      : "editor.revision.create",
                  )}
                </Button>
              </div>
            </div>
          </details>
          {revisionPreview &&
            props.renderFactorySlot("automation.change-preview", {
              preview: revisionPreview as ChangePreviewFactoryProps["preview"],
            })}
        </section>
      )}
      {packageId && (
        <section className={css.split}>
          <section className={css.box}>
            <h3 className={css.heading}>{t("editor.comment.title")}</h3>
            {field(
              t("editor.comment.shot"),
              <select
                className={css.select}
                value={shotId}
                onChange={(event) => setShotId(event.target.value)}
              >
                <option value="">{t("editor.comment.shot.none")}</option>
                {clips.map((clip) => (
                  <option key={clip.shotId} value={clip.shotId}>
                    {clip.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              t("editor.comment.timecode"),
              <input
                className={css.input}
                type="number"
                min="0"
                step="0.1"
                value={timecode}
                onChange={(event) => setTimecode(event.target.value)}
              />,
            )}
            {field(
              t("editor.comment.alias"),
              <input
                className={css.input}
                value={authorAlias}
                onChange={(event) => setAuthorAlias(event.target.value)}
              />,
            )}
            {field(
              t("editor.comment.body"),
              <textarea
                className={css.textarea}
                value={commentBody}
                placeholder={t("editor.comment.body.placeholder")}
                onChange={(event) => setCommentBody(event.target.value)}
              />,
            )}
            <div>
              <Button variant="primary" disabled={busy} onClick={createComment}>
                {t(
                  working === "comment" ? "busy.saving" : "editor.comment.save",
                )}
              </Button>
            </div>
            {!commentList.length && (
              <p className={css.muted}>{t("editor.comments.empty")}</p>
            )}
            {commentList.map((comment) => (
              <div key={comment.id} className={css.item}>
                <div className={clsx(css.row, css.between)}>
                  <span>
                    {t("editor.comment.state", {
                      state: t(
                        comment.resolved
                          ? "editor.comment.resolved"
                          : "editor.comment.open",
                      ),
                      alias:
                        comment.authorAlias ?? t("editor.comment.anonymous"),
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      resolveComment(comment.id, !comment.resolved)
                    }
                  >
                    {t(
                      comment.resolved
                        ? "editor.comment.reopen"
                        : "editor.comment.resolve",
                    )}
                  </Button>
                </div>
                <p>{comment.body}</p>
                {comment.timecodeSeconds !== undefined && (
                  <p className={clsx(css.muted, css.small)}>
                    {t("editor.comment.at", {
                      seconds: comment.timecodeSeconds,
                    })}
                  </p>
                )}
              </div>
            ))}
          </section>
          <section className={css.box}>
            <h3 className={css.heading}>{t("editor.decision.title")}</h3>
            {field(
              t("editor.decision.label"),
              <select
                aria-label={t("editor.decision.field")}
                className={css.select}
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as Decision)
                }
              >
                {DECISIONS.map((item) => (
                  <option key={item} value={item}>
                    {t(`editor.decision.${item}`)}
                  </option>
                ))}
              </select>,
            )}
            {field(
              t("editor.decision.explain"),
              <textarea
                className={css.textarea}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
              />,
            )}
            <div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={createDecision}
              >
                {t(
                  working === "decision"
                    ? "busy.saving"
                    : "editor.decision.save",
                )}
              </Button>
            </div>
            {!decisionList.length && (
              <p className={css.muted}>{t("editor.decisions.empty")}</p>
            )}
            {decisionList.map((item) => (
              <div key={item.id} className={css.item}>
                <p>
                  {item.authorAlias
                    ? t("editor.decision.by", {
                        decision: t(`editor.decision.${item.decision}`),
                        alias: item.authorAlias,
                      })
                    : t(`editor.decision.${item.decision}`)}
                </p>
                {item.note && <p className={css.muted}>{item.note}</p>}
              </div>
            ))}
          </section>
        </section>
      )}
      {notice && <p className={css.notice}>{notice}</p>}
    </section>
  );
}
