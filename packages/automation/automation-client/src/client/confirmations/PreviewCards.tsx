import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@dramaip/infra-ui-primitives";
import { usePoll, value } from "../creation/remote.ts";
import css from "./Confirmations.module.css";
import { useConfirm } from "./ConfirmDialog.tsx";
import {
  providerEstimate,
  providerStatusText,
  readProjectProviderReview,
  readTaskProviderReview,
  requireUnchangedProviderReview,
} from "./provider-review.ts";
import {
  explained,
  failureText,
  MismatchError,
  type ChangePreview,
  type ProjectRecord,
  type ProviderActionPreview,
  type RevisionPreview,
  type Task,
  type TaskRemotes,
  type Translate,
} from "./remote.ts";

/** What every preview card reads with and reports to. */
export interface PreviewCardProps {
  remotes: TaskRemotes;
  t: Translate;
  /** A preview changed state; the owner reads its lists again. */
  onChanged: () => void;
}

const TARGET_KINDS = [
  "project",
  "chapter",
  "character",
  "outline",
  "story_bible",
  "episode",
  "script",
  "scene",
  "shot",
] as const;

type TargetKind = (typeof TARGET_KINDS)[number] | "other";

const targetKind = (kind: string): TargetKind =>
  (TARGET_KINDS as readonly string[]).includes(kind)
    ? (kind as TargetKind)
    : "other";

/**
 * The text a change target is previewed with: its proposed content, or its
 * diff or patch as JSON.
 * @param target - one target of a change preview.
 */
export function changeTargetPreviewText(
  target: ChangePreview["targets"][number],
): string {
  const patch = target.patch as Record<string, unknown> | undefined;
  if (patch && typeof patch.content === "string") return patch.content;
  if (
    target.displayDiff &&
    typeof target.displayDiff === "object" &&
    !Array.isArray(target.displayDiff)
  ) {
    const diff = target.displayDiff as Record<string, unknown>;
    if (typeof diff.proposedContent === "string") return diff.proposedContent;
  }
  return JSON.stringify(target.displayDiff ?? target.patch, null, 2);
}

/** One write a card runs, with its own pending state and notice. */
function useAction(t: Translate) {
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const run = async (name: string, action: () => Promise<string | void>) => {
    setPending(name);
    try {
      const done = await action();
      setNotice(done || undefined);
    } catch (cause) {
      setNotice(failureText(t, cause));
    } finally {
      setPending(undefined);
    }
  };
  return { pending, notice, setNotice, run };
}

/** A chapter revision an AI task drafted, adopted or discarded here. */
export function RevisionPreviewCard({
  preview,
  projectId,
  remotes,
  t,
  onChanged,
}: PreviewCardProps & {
  preview: RevisionPreview;
  projectId?: string | undefined;
}) {
  const [status, setStatus] = useState(preview.status);
  useEffect(() => setStatus(preview.status), [preview.id, preview.status]);
  const action = useAction(t);
  const confirm = useConfirm(t);
  const busy = action.pending !== undefined;
  const commit = () =>
    action.run("commit", async () => {
      await value(
        remotes.automation.revisionsCommit(
          preview.id,
          { version: preview.baseVersion },
          undefined,
          crypto.randomUUID(),
        ),
      );
      setStatus("committed");
      onChanged();
      return t("preview.revision.committed");
    });
  const discard = async () => {
    if (!(await confirm.ask(t("preview.revision.discardConfirm")))) return;
    await action.run("discard", async () => {
      await value(
        remotes.automation.revisionsDiscard(
          preview.id,
          undefined,
          crypto.randomUUID(),
        ),
      );
      setStatus("discarded");
      onChanged();
      return t("preview.revision.discarded");
    });
  };
  return (
    <section className={css.preview}>
      <div className={css.cardHeader}>
        <div>
          <p className={css.heading}>{t("preview.revision.title")}</p>
          <p className={css.small}>
            {t("preview.revision.basis", { version: preview.baseVersion })}
          </p>
        </div>
        <span className={css.badge} data-tone="info">
          {t(`preview.revision.state.${status}`)}
        </span>
      </div>
      {preview.rationale && (
        <p className={clsx(css.text, css.muted)}>{preview.rationale}</p>
      )}
      <details className={css.details}>
        <summary className={css.summary}>{t("preview.revision.draft")}</summary>
        <pre className={css.code}>{preview.proposedContent}</pre>
      </details>
      {(status === "pending" || status === "conflicted") && (
        <div className={css.row}>
          {status === "pending" && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void commit()}
            >
              {t(
                action.pending === "commit"
                  ? "preview.revision.committing"
                  : "preview.revision.commit",
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void discard()}
          >
            {t(
              action.pending === "discard"
                ? "preview.discarding"
                : "preview.discard",
            )}
          </Button>
        </div>
      )}
      {action.notice && <p className={css.small}>{action.notice}</p>}
      {status === "committed" && projectId && (
        <a
          className={css.link}
          href={`#/projects/${encodeURIComponent(projectId)}`}
        >
          {t("preview.revision.back")}
        </a>
      )}
      {confirm.dialog}
    </section>
  );
}

const UNRECORDED = Symbol("unrecorded");

function recordedSection(
  text: string | undefined,
  heading: string,
): string | typeof UNRECORDED {
  if (!text) return UNRECORDED;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*\\n【|$)`,
  ).exec(text);
  return match?.[1]?.trim() || UNRECORDED;
}

/**
 * Which parts of a change came from the author, from the story preset and
 * from the AI, read from the sections the project's synopsis and style guide
 * record.
 */
function CreativeIntent({
  project,
  preview,
  t,
}: {
  project: ProjectRecord;
  preview: ChangePreview;
  t: Translate;
}) {
  const shown = (text: string | typeof UNRECORDED) =>
    text === UNRECORDED ? t("intent.unrecorded") : text;
  const idea = [
    recordedSection(project.synopsis, "用户灵感"),
    recordedSection(project.styleGuide, "创作灵感"),
    recordedSection(project.styleGuide, "用户灵感优先"),
  ].find((text): text is string => text !== UNRECORDED);
  const preset = /【完整故事预设】\s*([^\n]+)/
    .exec(project.styleGuide ?? "")?.[1]
    ?.trim();
  return (
    <section className={css.card}>
      <div className={css.cardHeader}>
        <div>
          <p className={css.eyebrow}>{t("intent.eyebrow")}</p>
          <h3 className={css.heading}>{t("intent.heading")}</h3>
        </div>
        <span className={css.badge} data-tone="info">
          {t(`intent.state.${preview.status}`)}
        </span>
      </div>
      <div className={css.intent}>
        <div className={css.intentCell}>
          <p className={css.eyebrow}>{t("intent.user")}</p>
          <p className={css.text}>{shown(idea ?? UNRECORDED)}</p>
        </div>
        <div className={css.intentCell}>
          <p className={css.eyebrow}>{t("intent.preset")}</p>
          <p className={css.text}>
            {t("intent.presetName", {
              name: preset || t("intent.unrecorded"),
            })}
          </p>
          <p className={clsx(css.text, css.muted)}>
            {shown(recordedSection(project.synopsis, "预设展开方向"))}
          </p>
        </div>
        <div className={css.intentCell}>
          <p className={css.eyebrow}>{t("intent.ai")}</p>
          <p className={css.text}>
            {preview.rationale.trim() || t("intent.unrecorded")}
          </p>
          {preview.targets.length > 0 && (
            <ul className={css.list}>
              {preview.targets.map((target) => (
                <li key={`${target.kind}-${target.id}`}>
                  {t("intent.change", {
                    label: t(`intent.target.${targetKind(target.kind)}`),
                    version: target.baseVersion,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** A multi-target change an AI task proposed, applied or discarded here. */
export function ChangePreviewCard({
  preview,
  remotes,
  t,
  onChanged,
}: PreviewCardProps & { preview: ChangePreview }) {
  const [status, setStatus] = useState(preview.status);
  useEffect(() => setStatus(preview.status), [preview.id, preview.status]);
  const project = usePoll(`project:${preview.projectId}`, () =>
    value<ProjectRecord>(remotes.workspace.projectsGet(preview.projectId)),
  );
  const action = useAction(t);
  const confirm = useConfirm(t);
  const busy = action.pending !== undefined;
  const count = preview.targets.length;
  const commit = async () => {
    if (!(await confirm.ask(t("preview.change.confirm", { count })))) return;
    await action.run("commit", async () => {
      const next = await value<ChangePreview>(
        remotes.automation.changePreviewsCommit(
          preview.id,
          undefined,
          crypto.randomUUID(),
        ),
      );
      setStatus(next.status);
      onChanged();
      return t("preview.change.committed");
    });
  };
  const discard = () =>
    action.run("discard", async () => {
      const next = await value<ChangePreview>(
        remotes.automation.changePreviewsDiscard(
          preview.id,
          undefined,
          crypto.randomUUID(),
        ),
      );
      setStatus(next.status);
      onChanged();
      return t("preview.change.discarded");
    });
  return (
    <section className={css.preview}>
      <div className={css.cardHeader}>
        <div>
          <p className={css.heading}>{t("preview.change.title")}</p>
          <p className={css.small}>{t("preview.change.scope", { count })}</p>
        </div>
        <span className={css.badge} data-tone="info">
          {t(`preview.change.state.${status}`)}
        </span>
      </div>
      <p className={clsx(css.text, css.muted)}>{preview.rationale}</p>
      {project.data && (
        <CreativeIntent
          project={project.data}
          preview={{ ...preview, status }}
          t={t}
        />
      )}
      {preview.targets.map((target, index) => (
        <details key={`${target.kind}-${target.id}`} className={css.details}>
          <summary className={css.summary}>
            {t("preview.change.target", {
              index: index + 1,
              label: t(`preview.target.${targetKind(target.kind)}`),
              version: target.baseVersion,
            })}
          </summary>
          <pre className={css.code}>{changeTargetPreviewText(target)}</pre>
        </details>
      ))}
      {status === "pending" && (
        <div className={css.row}>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void commit()}
          >
            {t(
              action.pending === "commit"
                ? "preview.change.committing"
                : "preview.change.commit",
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void discard()}
          >
            {t(
              action.pending === "discard"
                ? "preview.discarding"
                : "preview.discard",
            )}
          </Button>
        </div>
      )}
      {status === "conflicted" && (
        <div className={css.notice}>
          <p className={css.text}>{t("preview.change.conflict")}</p>
          <div className={css.row}>
            <button
              type="button"
              className={css.linkButton}
              onClick={() => {
                project.refresh();
                onChanged();
                action.setNotice(t("preview.change.reloaded"));
              }}
            >
              {t("preview.change.reload")}
            </button>
            <a
              className={css.link}
              href={`#/tasks?projectId=${encodeURIComponent(preview.projectId)}`}
            >
              {t("preview.change.regenerate")}
            </a>
          </div>
        </div>
      )}
      {action.notice && <p className={css.small}>{action.notice}</p>}
      {confirm.dialog}
    </section>
  );
}

/** What the change preview factory renders: one preview and its reader. */
export interface ChangePreviewFactoryProps {
  preview: ChangePreview;
  /** The preview was applied or discarded; the owner reads again. */
  onChanged?: (() => void) | undefined;
}

/** The change preview card any domain client renders for its own preview. */
export function ChangePreviewFactory({
  preview,
  onChanged,
  automation,
  workspace,
  writing,
  t,
}: ChangePreviewFactoryProps & TaskRemotes & { t: Translate }) {
  return (
    <ChangePreviewCard
      preview={preview}
      remotes={{ automation, workspace, writing }}
      t={t}
      onChanged={() => onChanged?.()}
    />
  );
}

/**
 * A provider call an AI task prepared: read again from its owner every 1.5
 * seconds, through the task whose result binds it, or through its project
 * when no task does. Nothing shows until a read of this mount lands.
 */
export function ProviderPreviewCard({
  preview,
  task,
  projectId,
  remotes,
  t,
  onChanged,
}: PreviewCardProps & {
  preview: Pick<ProviderActionPreview, "id">;
  task?: Task | undefined;
  projectId?: string | undefined;
}) {
  const bindingProject = task?.projectId ?? projectId ?? "";
  const read = () =>
    task
      ? readTaskProviderReview(remotes, {
          id: preview.id,
          projectId: bindingProject,
          task,
        })
      : readProjectProviderReview(remotes, {
          id: preview.id,
          projectId: bindingProject,
        });
  const key = `${bindingProject}:${preview.id}:${task?.id ?? "owner-preview"}`;
  const actual = usePoll(`provider:${key}`, explained(t, read), {
    interval: 1500,
  });
  if (actual.error || !actual.data)
    return (
      <p role={actual.error ? "alert" : "status"} className={css.alert}>
        {actual.error ?? t("provider.card.reading")}
      </p>
    );
  return (
    <ReviewedProviderCard
      key={key}
      preview={actual.data}
      read={read}
      t={t}
      remotes={remotes}
      onChanged={() => {
        actual.refresh();
        onChanged();
      }}
    />
  );
}

function ReviewedProviderCard({
  preview,
  read,
  remotes,
  t,
  onChanged,
}: PreviewCardProps & {
  preview: ProviderActionPreview;
  read: () => Promise<ProviderActionPreview>;
}) {
  const alive = useRef(false);
  const executeKey = useRef(crypto.randomUUID());
  const discardKey = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [pending, setPending] = useState<"execute" | "discard">();
  const [notice, setNotice] = useState<string>();
  const confirm = useConfirm(t);
  const estimate = providerEstimate(preview, t);
  const kind = t(`provider.kind.${preview.kind}`);
  const report = (cause: unknown) => {
    if (alive.current) setNotice(failureText(t, cause));
  };
  const settle = async (
    name: "execute" | "discard",
    write: () => Promise<unknown>,
  ) => {
    setPending(name);
    try {
      await write();
      setNotice(undefined);
    } catch (cause) {
      report(cause);
    } finally {
      if (alive.current) setPending(undefined);
      onChanged();
    }
  };
  const execute = async () => {
    const reviewed = preview;
    setNotice(undefined);
    try {
      const current = await read();
      if (!alive.current) return;
      requireUnchangedProviderReview(current, reviewed, t);
      const accepted = await confirm.ask(
        t("provider.card.confirm", {
          kind,
          estimate: providerEstimate(reviewed, t).label,
        }),
      );
      if (!accepted || !alive.current) return;
    } catch (cause) {
      report(cause);
      onChanged();
      return;
    }
    await settle("execute", async () => {
      if (!alive.current) throw new MismatchError("mismatch.providerLeft");
      const current = await read();
      if (!alive.current) throw new MismatchError("mismatch.providerLeft");
      requireUnchangedProviderReview(current, reviewed, t);
      await value(
        remotes.automation.providerActionPreviewsExecute(
          current.id,
          undefined,
          executeKey.current,
        ),
      );
    });
  };
  const discard = () =>
    settle("discard", async () => {
      const current = await read();
      if (!alive.current || current.status !== "pending")
        throw new MismatchError("mismatch.providerDiscardChanged");
      await value(
        remotes.automation.providerActionPreviewsDiscard(
          current.id,
          undefined,
          discardKey.current,
        ),
      );
    });
  const fact = (label: string, text: ReactNode) => (
    <div>
      <dt>{label}</dt>
      <dd>{text}</dd>
    </div>
  );
  return (
    <section aria-label={t("provider.card.label")} className={css.preview}>
      <div className={css.cardHeader}>
        <div>
          <p className={css.heading}>{t("provider.card.title", { kind })}</p>
          <p className={css.small}>{t("provider.card.note")}</p>
        </div>
        <span className={css.badge} data-tone="warning">
          {providerStatusText(t, preview.status)}
        </span>
      </div>
      <dl className={css.facts}>
        {fact(t("provider.card.provider"), preview.providerId)}
        {preview.modelId && fact(t("provider.card.model"), preview.modelId)}
        {fact(t("provider.card.estimate"), estimate.label)}
      </dl>
      <p className={css.small}>{t("provider.card.estimateNote")}</p>
      <details className={css.details}>
        <summary className={css.summary}>
          {t("provider.card.parameters")}
        </summary>
        <pre className={css.code}>
          {JSON.stringify(preview.parameters, null, 2)}
        </pre>
      </details>
      {preview.status === "pending" && (
        <div className={css.row}>
          <Button
            variant="primary"
            size="sm"
            disabled={!estimate.known || pending !== undefined}
            onClick={() => void execute()}
          >
            {t(
              pending === "execute"
                ? "provider.card.executing"
                : "provider.card.execute",
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending !== undefined}
            onClick={() => void discard()}
          >
            {t(
              pending === "discard"
                ? "preview.discarding"
                : "provider.card.discard",
            )}
          </Button>
        </div>
      )}
      {preview.status === "pending" && !estimate.known && (
        <p className={css.small}>{t("provider.card.unknown")}</p>
      )}
      {notice && (
        <p role="alert" className={css.alert}>
          {notice}
        </p>
      )}
      {confirm.dialog}
    </section>
  );
}
