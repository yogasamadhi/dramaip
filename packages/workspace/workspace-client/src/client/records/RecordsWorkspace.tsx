import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { Button, Modal } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import clsx from "clsx";
import css from "./Records.module.css";

/** One stored record of a domain, as its records Remote lists it. */
export interface RecordEntity {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly payload?: unknown;
}

/** What a new record is created from. */
export interface RecordCreateInput {
  title: string;
  projectId: string | undefined;
  parentId: string | undefined;
  payload: Record<string, unknown>;
  /** The grant of a chosen local file, for a domain that takes one. */
  capabilityToken?: string | undefined;
}

/**
 * The records Remote calls of one domain. The domain's client binds them to
 * its own namespace, so this workspace never names a domain's methods.
 */
export interface RecordsStore {
  list(query: {
    projectId: string | undefined;
    parentId: string | undefined;
  }): Promise<readonly RecordEntity[]>;
  create(input: RecordCreateInput): Promise<unknown>;
  update(
    id: string,
    input: { title: string; payload: Record<string, unknown>; version: number },
  ): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

export type RecordFieldKind = "text" | "multiline" | "number" | "switch";

/** One payload field of a domain's records, keyed as the payload stores it. */
export interface RecordField {
  key: string;
  label: string;
  kind: RecordFieldKind;
  placeholder?: string | undefined;
}

/**
 * One extra action on a record. `run` answers the notice to show; `panel`
 * opens an inline panel under the editor instead.
 */
export interface RecordAction {
  key: string;
  label: string;
  /** Outlined under the record rather than beside its title. */
  row?: boolean | undefined;
  run?: (() => Promise<string | undefined>) | undefined;
  panel?: ((close: () => void) => ReactNode) | undefined;
}

/** One domain the workspace offers, described by the domain's client. */
export interface RecordsDomain {
  id: string;
  label: string;
  description: string;
  titleLabel: string;
  /** False for records that may also be global (no project). */
  projectRequired?: boolean | undefined;
  fields: readonly RecordField[];
  store: RecordsStore;
  /** New records may carry one local file. */
  file?: boolean | undefined;
  actions?:
    | ((
        item: RecordEntity,
        payload: Record<string, unknown>,
      ) => readonly RecordAction[])
    | undefined;
  /** Details shown after the first three filled fields. */
  extraDetails?:
    | ((
        payload: Record<string, unknown>,
      ) => readonly { label: string; value: unknown }[])
    | undefined;
}

/** Props of the `workspace.records` Factory. */
export interface RecordsWorkspaceProps {
  /** The owning area, shown as `{title}资料库`. */
  title: string;
  domains: readonly RecordsDomain[];
  /** Fixed project; without it the workspace offers the project choice. */
  projectId?: string | undefined;
  parentId?: string | undefined;
  parentRequired?: boolean | undefined;
}

/** The Remote namespaces the workspace reads itself. */
export interface RecordsRemotes {
  workspace: Context["remote"]["workspace"];
  system: Context["remote"]["system"];
}

/**
 * The payload of a record as an object.
 * @param value - the stored payload.
 */
export function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const filled = (value: unknown) =>
  value !== undefined && value !== null && value !== "";

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

function draftOf(
  fields: readonly RecordField[],
  payload: Record<string, unknown>,
): Record<string, string | boolean> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = payload[field.key];
      return [
        field.key,
        field.kind === "switch"
          ? Boolean(value)
          : value === undefined || value === null
            ? ""
            : String(value),
      ];
    }),
  );
}

/**
 * The records workspace of one area: a tab per domain, the project choice
 * when none is fixed, the editor of a new or existing record, and the
 * records as cards with the domain's own actions.
 */
export function RecordsWorkspace(
  props: RecordsWorkspaceProps &
    RecordsRemotes & { t: TranslateNS<"workspace"> },
) {
  const { t, domains } = props;
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const domain = domains.find((entry) => entry.id === domainId) ?? domains[0];
  const [chosenProject, setChosenProject] = useState("");
  const projectId = props.projectId ?? chosenProject;
  const [projects, setProjects] = useState<
    readonly { id: string; title: string }[]
  >([]);
  const [items, setItems] = useState<readonly RecordEntity[]>();
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<RecordEntity | "new">();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [basePayload, setBasePayload] = useState<Record<string, unknown>>({});
  const [file, setFile] = useState<{ grantId: string; displayName: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [removing, setRemoving] = useState<RecordEntity>();
  const [panel, setPanel] = useState<RecordAction>();

  const domainKey = domains.map((entry) => entry.id).join(",");
  useEffect(() => {
    setDomainId(domains[0]?.id ?? "");
    setEditor(undefined);
    setFile(undefined);
    // Only a different set of domains resets the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainKey]);

  useEffect(() => {
    if (props.projectId !== undefined) return;
    let live = true;
    void props.workspace.projectsList().then((result) => {
      if (live && result.ok) setProjects(result.value);
    });
    return () => {
      live = false;
    };
  }, [props.projectId, props.workspace]);

  // The owner may describe its domains anew on every render; only another
  // domain, scope or an explicit reload reads the records again.
  const current = useRef(domain);
  current.current = domain;
  useEffect(() => {
    const domain = current.current;
    if (!domain) return;
    let live = true;
    setLoadError(undefined);
    domain.store
      .list({ projectId: projectId || undefined, parentId: props.parentId })
      .then(
        (next) => {
          if (live) setItems(next);
        },
        (cause: unknown) => {
          if (!live) return;
          setItems([]);
          setLoadError(messageOf(cause));
        },
      );
    return () => {
      live = false;
    };
  }, [domain?.id, projectId, props.parentId, revision]);

  if (!domain) return null;
  const reload = () => setRevision((value) => value + 1);

  const openEditor = (item: RecordEntity | "new") => {
    const payload = item === "new" ? {} : recordPayload(item.payload);
    setEditor(item);
    setTitle(item === "new" ? "" : item.title);
    setBasePayload(payload);
    setDraft(draftOf(domain.fields, payload));
    setFile(undefined);
    setError(undefined);
    setNotice(undefined);
  };

  const chooseFile = async () => {
    const result = await props.system.pickFiles({ multiple: false });
    const first = result.ok ? result.value?.[0] : undefined;
    if (!first) return;
    setFile(first);
    if (!title.trim()) setTitle(first.displayName);
  };

  const save = async () => {
    if (!editor || !title.trim()) return;
    if (domain.projectRequired !== false && !projectId) {
      setError(t("records.need.project"));
      return;
    }
    if (props.parentRequired && !props.parentId) {
      setError(t("records.need.parent"));
      return;
    }
    const payload: Record<string, unknown> = { ...basePayload };
    for (const field of domain.fields) {
      const value = draft[field.key];
      payload[field.key] =
        field.kind === "number"
          ? value === "" || value === undefined
            ? undefined
            : Number(value)
          : value;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (editor === "new")
        await domain.store.create({
          title: title.trim(),
          projectId: projectId || undefined,
          parentId: props.parentId,
          payload,
          ...(file && domain.file ? { capabilityToken: file.grantId } : {}),
        });
      else
        await domain.store.update(editor.id, {
          title: title.trim(),
          payload,
          version: editor.version,
        });
      setEditor(undefined);
      setFile(undefined);
      reload();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: RecordEntity) => {
    setRemoving(undefined);
    try {
      await domain.store.remove(item.id);
      reload();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const act = async (action: RecordAction) => {
    if (action.panel) {
      setPanel(action);
      setError(undefined);
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      const said = await action.run?.();
      if (said) setNotice(said);
      reload();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const update = (key: string, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className={css.workspace}>
      <div className={css.head}>
        <div>
          <p className={css.eyebrow}>
            {t("records.eyebrow", { title: props.title })}
          </p>
          <h2 className={css.title}>{domain.label}</h2>
          <p className={css.description}>{domain.description}</p>
        </div>
        <Button onClick={() => openEditor("new")}>
          {t("records.create", { label: domain.label })}
        </Button>
      </div>
      {domains.length > 1 && (
        <div
          className={css.tabs}
          role="tablist"
          aria-label={t("records.domains")}
        >
          {domains.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === domain.id}
              className={clsx(css.tab, entry.id === domain.id && css.tabOn)}
              onClick={() => {
                setDomainId(entry.id);
                setEditor(undefined);
                setPanel(undefined);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {props.projectId === undefined && (
        <div className={css.box}>
          <label className={css.field}>
            {t("records.project")}
            <select
              className={css.input}
              value={chosenProject}
              onChange={(event) => setChosenProject(event.target.value)}
            >
              {domain.projectRequired === false && (
                <option value="">{t("records.project.global")}</option>
              )}
              {domain.projectRequired !== false && !chosenProject && (
                <option value="">{t("records.need.project")}</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {editor && (
        <section className={css.editor}>
          <div className={css.editorHead}>
            <div>
              <h2 className={css.editorTitle}>
                {t(editor === "new" ? "records.create" : "records.edit", {
                  label: domain.label,
                })}
              </h2>
              <p className={css.description}>{t("records.editor.hint")}</p>
            </div>
            <Button variant="ghost" onClick={() => setEditor(undefined)}>
              {t("records.cancel")}
            </Button>
          </div>
          <div className={css.fields}>
            <label className={css.field}>
              {domain.titleLabel}
              <input
                className={css.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {domain.fields.map((field) => (
              <label
                key={field.key}
                className={clsx(
                  css.field,
                  field.kind === "multiline" && css.wide,
                )}
              >
                {field.label}
                {field.kind === "multiline" ? (
                  <textarea
                    className={css.textarea}
                    placeholder={field.placeholder}
                    value={String(draft[field.key] ?? "")}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                ) : field.kind === "switch" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(draft[field.key])}
                    onChange={(event) =>
                      update(field.key, event.target.checked)
                    }
                  />
                ) : (
                  <input
                    className={css.input}
                    type={field.kind === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                    value={String(draft[field.key] ?? "")}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          {domain.file && editor === "new" && (
            <div className={css.file}>
              <Button variant="outline" onClick={() => void chooseFile()}>
                {file
                  ? t("records.file.picked", { name: file.displayName })
                  : t("records.file.pick")}
              </Button>
              <p className={css.hint}>{t("records.file.hint")}</p>
            </div>
          )}
          {error && (
            <p role="alert" className={css.error}>
              {error}
            </p>
          )}
          <div className={css.end}>
            <Button
              disabled={!title.trim() || saving}
              onClick={() => void save()}
            >
              {t(saving ? "records.saving" : "records.save")}
            </Button>
          </div>
        </section>
      )}
      {panel?.panel && (
        <section className={css.editor}>
          {panel.panel(() => setPanel(undefined))}
        </section>
      )}
      {loadError && (
        <p role="alert" className={css.error}>
          {loadError}
        </p>
      )}
      {error && !editor && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={css.notice}>
          {notice}
        </p>
      )}
      {items === undefined ? (
        <p role="status" className={css.hint}>
          {t("records.loading")}
        </p>
      ) : (
        <div className={css.grid}>
          {items.map((item) => {
            const payload = recordPayload(item.payload);
            const details = [
              ...domain.fields
                .map((field) => ({
                  label: field.label,
                  value: payload[field.key],
                }))
                .filter(({ value }) => filled(value))
                .slice(0, 3),
              ...(domain.extraDetails?.(payload) ?? []).filter(({ value }) =>
                filled(value),
              ),
            ];
            const actions = domain.actions?.(item, payload) ?? [];
            const row = actions.filter((action) => action.row);
            return (
              <article key={item.id} className={css.card}>
                <div className={css.cardHead}>
                  <div className={css.grow}>
                    <p className={css.cardTitle}>{item.title}</p>
                    <p className={css.hint}>
                      {t("records.version", { version: item.version })}
                    </p>
                  </div>
                  <div className={css.actions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditor(item)}
                    >
                      {t("records.item.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={css.danger}
                      onClick={() => setRemoving(item)}
                    >
                      {t("records.item.remove")}
                    </Button>
                    {actions
                      .filter((action) => !action.row)
                      .map((action) => (
                        <Button
                          key={action.key}
                          size="sm"
                          variant="ghost"
                          onClick={() => void act(action)}
                        >
                          {action.label}
                        </Button>
                      ))}
                  </div>
                </div>
                {row.length > 0 && (
                  <div className={css.row}>
                    {row.map((action) => (
                      <Button
                        key={action.key}
                        size="sm"
                        variant="outline"
                        onClick={() => void act(action)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
                <dl className={css.details}>
                  {details.map(({ label, value }) => (
                    <div key={label} className={css.detail}>
                      <dt className={css.hint}>{label}</dt>
                      <dd className={css.value}>{String(value)}</dd>
                    </div>
                  ))}
                  {!details.length && (
                    <p className={css.hint}>{t("records.details.none")}</p>
                  )}
                </dl>
              </article>
            );
          })}
          {!items.length && (
            <p className={css.empty}>
              {t("records.empty", { label: domain.label })}
            </p>
          )}
        </div>
      )}
      <Modal
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={t("records.remove.title")}
        closeLabel={t("records.close")}
        description={t("records.remove.confirm", {
          title: removing?.title ?? "",
        })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(undefined)}>
              {t("records.cancel")}
            </Button>
            <Button onClick={() => removing && void remove(removing)}>
              {t("records.remove.accept")}
            </Button>
          </>
        }
      />
    </section>
  );
}
