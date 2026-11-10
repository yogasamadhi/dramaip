import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  AuthorIntentsCurrentResult,
  AuthorIntentsGetResult,
  AuthorIntentsListResult,
} from "@dramaip/workspace-workspace/types";
import { useConfirm } from "../tools/confirm.tsx";
import { usePublishedEvents } from "../tools/events.ts";
import { useOwnerRead } from "../tools/owner-read.ts";
import type { ToolProps } from "../tools/PersonalTheaterTool.tsx";
import { messageOf, value } from "../tools/remote.ts";
import {
  AuthorIntentCreation,
  useIntentSources,
} from "./AuthorIntentCreation.tsx";
import {
  INTENT_FIELDS,
  clearAuthorIntentDraft,
  emptyAuthorIntentEdit,
  intentContent,
  readAuthorIntentDraft,
  saveAuthorIntentDraft,
  type AuthorIntentEdit,
  type AuthorIntentEditFields,
  type DraftError,
} from "./draft.ts";
import { ambiguousNavigation, sameFrozenSnapshot } from "./request.ts";
import css from "./Intent.module.css";

type Intent = AuthorIntentsGetResult;
type Adopted = NonNullable<AuthorIntentsCurrentResult["current"]>;
type Summary = AuthorIntentsListResult["items"][number];
type DraftNotice = DraftError | "recovered" | "saved" | "cleared";

const draftStore = () => window.localStorage;
const text = (field: string | string[]) =>
  Array.isArray(field) ? field.join("\n") : field;
const SOURCE_EVENTS = [
  "writing.chapter-",
  "production.script-",
  "production.scripts-",
  "production.screenplay-",
];

/** The author intent tool, started over for each project. */
export function AuthorIntentEntry(props: ToolProps) {
  return <AuthorIntentTool key={props.projectId} {...props} />;
}

/**
 * The project's author intent: an editor kept as a local draft per project
 * and frozen to the project and adopted intent it was started from, the
 * versions and AI drafts, the chosen version compared with the adopted one,
 * and explicit adoption or discarding. Nothing is adopted without the
 * author's confirmation, and a draft whose sources changed cannot be.
 */
export function AuthorIntentTool(props: ToolProps) {
  const { t, projectId, workspace } = props;
  const params = new URLSearchParams(props.search);
  const navigationError = ambiguousNavigation(params, [
    "intentId",
    "intentWorkflowId",
  ]);
  const selectedId = params.get("intentId") ?? undefined;
  const workflowId = params.get("intentWorkflowId") ?? undefined;
  const [recovered] = useState(() =>
    readAuthorIntentDraft(projectId, draftStore),
  );
  const [edit, setEdit] = useState<AuthorIntentEdit>(
    () => recovered.record ?? emptyAuthorIntentEdit(0),
  );
  const editRef = useRef(edit);
  const storedRaw = useRef(recovered.raw);
  const restoreBlocked = useRef(Boolean(recovered.error));
  const initializedBasis = useRef(Boolean(recovered.record));
  const [draftNotice, setDraftNotice] = useState<DraftNotice | undefined>(
    recovered.error ?? (recovered.record ? "recovered" : undefined),
  );
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const adoptConfirm = useConfirm({
    title: t("intent.adopt.title"),
    cancel: t("intent.cancel"),
    close: t("intent.close"),
    accept: t("intent.adopt.accept"),
  });
  const discardConfirm = useConfirm({
    title: t("intent.discard.title"),
    cancel: t("intent.cancel"),
    close: t("intent.close"),
    accept: t("intent.discard.accept"),
  });
  const clearConfirm = useConfirm({
    title: t("intent.clear.title"),
    cancel: t("intent.cancel"),
    close: t("intent.close"),
    accept: t("intent.clear.accept"),
  });

  const updateEdit = (patch: Partial<AuthorIntentEdit>) => {
    const next = { ...editRef.current, ...patch };
    editRef.current = next;
    setEdit(next);
    if (restoreBlocked.current) return;
    const result = saveAuthorIntentDraft(
      projectId,
      next,
      storedRaw.current,
      draftStore,
    );
    if (result.raw !== undefined) {
      storedRaw.current = result.raw;
      setDraftNotice("saved");
    } else setDraftNotice(result.error);
  };
  const setFields = (
    change: (old: AuthorIntentEditFields) => AuthorIntentEditFields,
  ) => updateEdit({ fields: change(editRef.current.fields) });

  const project = useOwnerRead(`project:${projectId}`, () =>
    value(workspace.projectsGet(projectId)),
  );
  const current = useOwnerRead(`current:${projectId}`, () =>
    value(workspace.authorIntentsCurrent(projectId)),
  );
  const list = useOwnerRead(`list:${projectId}`, async () => {
    const items: Summary[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await value(
        workspace.authorIntentsList(
          projectId,
          cursor === undefined ? undefined : { cursor },
        ),
      );
      items.push(...page.items);
      cursor = page.nextCursor;
      if (cursor !== undefined && seen.has(cursor))
        throw new Error(t("intent.list.paging"));
      if (cursor !== undefined) seen.add(cursor);
    } while (cursor !== undefined);
    return items;
  });
  const selected = useOwnerRead(
    selectedId && !navigationError ? `intent:${selectedId}` : undefined,
    () => value(workspace.authorIntentsGet(selectedId!)),
  );
  const original = useOwnerRead(
    workflowId && selectedId && !navigationError
      ? `workflow:${workflowId}`
      : undefined,
    () => value(props.automation.creationGet(workflowId!)),
    1500,
  );
  const catalog = useIntentSources(props);

  const candidate = ((): Intent | undefined => {
    const intent = selected.data;
    if (navigationError || !intent) return undefined;
    if (intent.projectId !== projectId || intent.id !== selectedId) return;
    if (!workflowId) return intent;
    const run = original.data;
    return run &&
      run.id === workflowId &&
      run.input.projectId === projectId &&
      run.input.operation === "author-intent" &&
      run.authorIntentId === selectedId &&
      intent.source.kind === "ai-generated" &&
      intent.source.creation.workflowId === workflowId &&
      sameFrozenSnapshot(
        intent.source.creation.basis.request,
        run.input.authorIntentRequest,
      )
      ? intent
      : undefined;
  })();
  const adopted = current.data?.current;

  useEffect(() => {
    if (current.data && !initializedBasis.current) {
      initializedBasis.current = true;
      updateEdit({
        basisVersion: current.data.projectVersion,
        baseAdoptedId: current.data.current?.id,
      });
    }
    // Only the first read of the adopted version sets the editor's basis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.data]);

  const refresh = () =>
    Promise.all([current.refetch(), list.refetch(), selected.refetch()]);
  usePublishedEvents(props.system, (event) => {
    const intentEvent = event.type.startsWith("workspace.author-intent-");
    const projectEvent = event.type.startsWith("workspace.project-");
    const sourceEvent = SOURCE_EVENTS.some((prefix) =>
      event.type.startsWith(prefix),
    );
    if (!intentEvent && !projectEvent && !sourceEvent) return;
    const payload = event.payload as
      { id?: unknown; projectId?: unknown } | undefined;
    if (!payload || typeof payload !== "object") return;
    if ((projectEvent ? payload.id : payload.projectId) !== projectId) return;
    if (projectEvent) void project.refetch();
    void refresh();
    void catalog.refetch();
  });

  const path = (search: URLSearchParams) =>
    `/projects/${projectId}/tools/author-intent?${search}`;
  const select = (id: string) => {
    const search = new URLSearchParams(props.search);
    search.set("intentId", id);
    props.navigate(path(search));
  };
  const ready = Boolean(current.data) && current.error === undefined;

  const preview = async () => {
    const content = intentContent(edit.fields);
    if (!content) {
      setNotice(t("intent.preview.invalid"));
      return;
    }
    if (!ready) {
      setNotice(t("intent.preview.unverified"));
      return;
    }
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await value(
        workspace.authorIntentsPreview(
          projectId,
          {
            content,
            projectVersion: edit.basisVersion,
            sourceKind: edit.sourceKind,
            ...(edit.baseAdoptedId
              ? { baseAdoptedId: edit.baseAdoptedId }
              : {}),
          },
          undefined,
          crypto.randomUUID(),
        ),
      );
      if (!alive.current) return;
      select(result.id);
      setNotice(t("intent.preview.saved"));
      await refresh();
    } catch (cause) {
      if (alive.current) setNotice(messageOf(cause));
    } finally {
      if (alive.current) setWorking(false);
    }
  };
  const transition = async (intent: Intent, action: "adopt" | "discard") => {
    const confirm = action === "adopt" ? adoptConfirm : discardConfirm;
    const accepted = await confirm.ask(
      t(`intent.${action}.description`, { version: intent.version }),
    );
    if (!accepted || !alive.current) return;
    setWorking(true);
    try {
      const ifMatch = `"${intent.stateVersion}"`;
      const key = crypto.randomUUID();
      const result = await value(
        action === "adopt"
          ? workspace.authorIntentsAdopt(
              intent.id,
              { confirmed: true },
              ifMatch,
              key,
            )
          : workspace.authorIntentsDiscard(intent.id, {}, ifMatch, key),
      );
      if (!alive.current) return;
      setNotice(
        action === "adopt"
          ? t("intent.adopt.done", { version: result.version })
          : t("intent.discard.done"),
      );
    } catch (cause) {
      if (alive.current) setNotice(messageOf(cause));
    } finally {
      if (alive.current) {
        setWorking(false);
        await refresh();
      }
    }
  };
  const clear = async () => {
    const accepted = await clearConfirm.ask(t("intent.clear.description"));
    if (!accepted || !alive.current || !current.data) return;
    const result = clearAuthorIntentDraft(
      projectId,
      storedRaw.current,
      draftStore,
    );
    if (!result.cleared) {
      setDraftNotice(result.error);
      return;
    }
    storedRaw.current = null;
    restoreBlocked.current = false;
    initializedBasis.current = true;
    const next: AuthorIntentEdit = {
      ...emptyAuthorIntentEdit(current.data.projectVersion),
      baseAdoptedId: current.data.current?.id,
    };
    editRef.current = next;
    setEdit(next);
    setDraftNotice("cleared");
  };

  const status = (intent: Pick<Summary, "status">) =>
    t(`intent.status.${intent.status}`);
  const stale =
    current.data &&
    (edit.basisVersion !== current.data.projectVersion ||
      edit.baseAdoptedId !== current.data.current?.id);
  return (
    <section aria-label={t("intent.label")} className={css.tool}>
      <AuthorIntentCreation key={projectId} {...props} catalog={catalog} />
      <div className={css.card}>
        <p className={css.eyebrow}>{t("intent.eyebrow")}</p>
        <h2 className={css.title}>{t("intent.title")}</h2>
        <p className={css.muted}>{t("intent.description")}</p>
        {current.loading ? (
          <p role="status">{t("intent.current.loading")}</p>
        ) : current.error !== undefined ? (
          <p role="alert" className={css.danger}>
            {t("intent.current.failed", { message: messageOf(current.error) })}
          </p>
        ) : (
          <p className={css.strong} data-current-intent-id={adopted?.id ?? ""}>
            {adopted
              ? t("intent.current.version", { version: adopted.version })
              : t("intent.current.none")}
          </p>
        )}
        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={working || !ready || !project.data}
            onClick={() => {
              const record = project.data!;
              updateEdit({
                fields: {
                  ...editRef.current.fields,
                  targetAudience: record.targetAudience ?? "",
                  emotionalPromise: record.emotionalCore ?? "",
                  toneAndVoice: record.styleGuide ?? "",
                },
                basisVersion: record.version,
                baseAdoptedId: adopted?.id,
                sourceKind: "legacy-project",
              });
              setNotice(t("intent.legacy.notice"));
            }}
          >
            {t("intent.legacy")}
          </Button>
          {adopted && (
            <Button
              variant="outline"
              disabled={working || current.error !== undefined}
              onClick={() =>
                updateEdit({
                  fields: Object.fromEntries(
                    INTENT_FIELDS.map((name) => [
                      name,
                      text(adopted.content[name]),
                    ]),
                  ) as AuthorIntentEditFields,
                  sourceKind: "manual",
                  basisVersion: current.data!.projectVersion,
                  baseAdoptedId: adopted.id,
                })
              }
            >
              {t("intent.fromCurrent")}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={working}
            onClick={async () => {
              const result = await current.refetch();
              if (result && alive.current) {
                updateEdit({
                  basisVersion: result.projectVersion,
                  baseAdoptedId: result.current?.id,
                });
                setNotice(t("intent.refresh.notice"));
              }
              await Promise.all([
                list.refetch(),
                selected.refetch(),
                project.refetch(),
              ]);
            }}
          >
            {t("intent.refresh")}
          </Button>
        </div>
      </div>
      <div className={css.card}>
        <h3 className={css.heading}>{t("intent.edit.title")}</h3>
        <p className={clsx(css.muted, css.small)}>
          {t("intent.edit.basis", {
            version: edit.basisVersion,
            source:
              edit.sourceKind === "legacy-project"
                ? t("intent.edit.source.legacy")
                : t("intent.edit.source.manual"),
          })}
        </p>
        {draftNotice && (
          <p
            role="status"
            aria-label={t("intent.draft.label")}
            className={css.muted}
          >
            {t(`intent.draft.${draftNotice}`)}
          </p>
        )}
        {stale && (
          <p role="alert" className={css.danger}>
            {t("intent.edit.stale")}
          </p>
        )}
        <div className={css.fields}>
          {INTENT_FIELDS.map((name) => (
            <label key={name} className={css.field}>
              {t(`intent.field.${name}`)}
              <textarea
                aria-label={t(`intent.field.${name}`)}
                className={css.textarea}
                disabled={working || !ready}
                value={edit.fields[name]}
                onChange={(event) => {
                  const next = event.target.value;
                  setFields((old) => ({ ...old, [name]: next }));
                }}
              />
            </label>
          ))}
        </div>
        <div className={css.actions}>
          <Button
            variant="primary"
            disabled={working || !ready}
            onClick={() => void preview()}
          >
            {t("intent.preview")}
          </Button>
          <Button
            variant="ghost"
            disabled={working || !ready}
            onClick={() => void clear()}
          >
            {t("intent.clear")}
          </Button>
        </div>
        {notice && (
          <p role="status" className={css.notice}>
            {notice}
          </p>
        )}
      </div>
      <div className={css.card}>
        <h3 className={css.heading}>{t("intent.versions")}</h3>
        {navigationError && <p role="alert">{t("intent.navigation")}</p>}
        {list.error !== undefined && (
          <p role="alert">
            {t("intent.list.failed", { message: messageOf(list.error) })}
          </p>
        )}
        <div className={css.actions}>
          {list.data?.map((item) => (
            <Button
              key={item.id}
              variant="outline"
              data-intent-id={item.id}
              onClick={() => select(item.id)}
            >
              {t("intent.list.item", {
                version: item.version,
                status: status(item),
                current: item.isCurrent ? t("intent.list.current") : "",
                stale:
                  item.sourceState === "stale" && item.status !== "adopted"
                    ? t("intent.list.stale")
                    : "",
              })}
            </Button>
          ))}
        </div>
        {selectedId && !candidate && !navigationError && (
          <p role={selected.loading ? "status" : "alert"}>
            {selected.loading
              ? t("intent.selected.loading")
              : t("intent.selected.missing")}
          </p>
        )}
        {candidate && (
          <Candidate
            {...props}
            candidate={candidate}
            adopted={adopted}
            disabled={
              working || selected.fetching || selected.error !== undefined
            }
            currentFailed={current.error !== undefined}
            status={status(candidate)}
            onTransition={(action) => void transition(candidate, action)}
          />
        )}
      </div>
      {adoptConfirm.dialog}
      {discardConfirm.dialog}
      {clearConfirm.dialog}
    </section>
  );
}

/** The chosen version, compared with the adopted one, and its actions. */
function Candidate(
  props: ToolProps & {
    candidate: Intent;
    adopted: Adopted | undefined;
    disabled: boolean;
    currentFailed: boolean;
    status: string;
    onTransition: (action: "adopt" | "discard") => void;
  },
) {
  const { t, candidate, adopted } = props;
  const { source } = candidate;
  return (
    <section
      aria-label={t("intent.candidate.label")}
      data-intent-preview-id={candidate.id}
      className={css.stack}
    >
      <h4 className={css.heading}>
        {t("intent.candidate.title", {
          version: candidate.version,
          status: props.status,
        })}
      </h4>
      <p className={clsx(css.muted, css.small)}>
        {t("intent.candidate.source", {
          kind: t(`intent.candidate.kind.${source.kind}`),
          projectVersion: source.projectVersion,
          stateVersion: candidate.stateVersion,
        })}
      </p>
      {candidate.sourceState === "stale" && candidate.status !== "adopted" && (
        <p role="alert" className={css.danger}>
          {t("intent.candidate.stale")}
        </p>
      )}
      <div className={css.scroll}>
        <table className={css.table}>
          <caption className={css.caption}>{t("intent.diff.caption")}</caption>
          <thead>
            <tr>
              <th className={css.cell}>{t("intent.diff.field")}</th>
              <th className={css.cell}>{t("intent.diff.current")}</th>
              <th className={css.cell}>{t("intent.diff.candidate")}</th>
            </tr>
          </thead>
          <tbody>
            {INTENT_FIELDS.map((name) => (
              <tr key={name}>
                <th className={css.cell}>{t(`intent.field.${name}`)}</th>
                <td className={clsx(css.cell, css.value)}>
                  {adopted
                    ? text(adopted.content[name]) || t("intent.diff.unset")
                    : t("intent.diff.none")}
                </td>
                <td className={clsx(css.cell, css.value)}>
                  {text(candidate.content[name]) || t("intent.diff.unset")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {source.kind !== "ai-generated" && source.legacyFields && (
        <details>
          <summary>{t("intent.legacyFields")}</summary>
          <dl className={css.stack}>
            {Object.entries(source.legacyFields).map(([name, field]) => (
              <div key={name}>
                <dt className={css.strong}>{name}</dt>
                <dd className={css.value}>{field || t("intent.diff.unset")}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {source.kind === "ai-generated" && (
        <details>
          <summary>{t("intent.provenance")}</summary>
          <p className={clsx(css.small, css.break)}>
            {t("intent.provenance.run", {
              workflowId: source.creation.workflowId,
              snapshotId: source.creation.sourceSnapshotId,
              engine: source.creation.engineKind,
              runs: source.creation.runIds.join(
                t("intent.provenance.runs.separator"),
              ),
            })}
          </p>
          <p className={css.small}>
            {t("intent.provenance.scope", {
              count: source.creation.basis.request.sources.length,
            })}
          </p>
          <ul className={clsx(css.stack, css.small)}>
            {source.creation.basis.references.map((reference) => (
              <li
                className={css.break}
                key={`${reference.sourceKind}:${reference.sourceId}`}
              >
                {t("intent.provenance.reference", {
                  kind: reference.sourceKind,
                  id: reference.sourceId,
                  version: reference.sourceVersion,
                  hash: reference.contentHash,
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className={css.actions}>
        {candidate.status === "pending" &&
          candidate.sourceState === "current" && (
            <Button
              variant="primary"
              disabled={props.disabled || props.currentFailed}
              onClick={() => props.onTransition("adopt")}
            >
              {t("intent.adopt")}
            </Button>
          )}
        {(candidate.status === "pending" ||
          candidate.status === "conflicted") && (
          <Button
            variant="outline"
            disabled={props.disabled}
            onClick={() => props.onTransition("discard")}
          >
            {t("intent.discard")}
          </Button>
        )}
      </div>
    </section>
  );
}
