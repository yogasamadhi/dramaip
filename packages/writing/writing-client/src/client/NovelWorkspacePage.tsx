import { useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { Button } from "@dramaip/infra-ui-primitives";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {
  LegacyNovelSection,
  LegacyNovelWorkspace,
  LegacyOutlineMode,
  LegacyProjectMode,
} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import { RouteLink } from "./WritingHomePage.tsx";
import css from "./Writing.module.css";

/** The sections, in the order the header offers them. */
const SECTIONS: readonly LegacyNovelSection[] = [
  "chapters",
  "outlines",
  "characters",
  "settings",
  "story-bible",
  "more",
];
const OUTLINE_MODES: readonly LegacyOutlineMode[] = ["book", "chapter", "arc"];

/** What the import and export menu exports, in its order. */
const EXPORTS = [
  "markdown",
  "submission-markdown",
  "submission-json",
  "json",
  "script",
  "storyboard",
  "delivery",
] as const;
type ExportFormat = (typeof EXPORTS)[number];

/** Full component props of the `/projects/:projectId` page. */
export type NovelWorkspacePageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<
    "writing.section" | "writing.banner" | "writing.manuscript"
  > &
  PropsLocale<"writing"> & {
    workspace: Context["remote"]["workspace"];
    system: Context["remote"]["system"];
  };

const pick = <T extends string>(
  values: readonly T[],
  value: string | null,
): T | undefined => values.find((item) => item === value);

/**
 * The novel workspace: reads the project and chapter the address names,
 * offers its sections, its import and export menu and its mode guide, and
 * lays out the chosen section's `writing.section` entry.
 */
export function NovelWorkspacePage(props: NovelWorkspacePageProps) {
  const { t, navigate } = props;
  const { params } = props.useRoute();
  const novel = props.useNovelWorkspace(params.projectId ?? "");
  if (novel.status !== "ready" || novel.project === undefined)
    return novel.status === "failed" ? (
      <section className={css.card}>
        <p role="alert">
          {t("workspace.failed", { message: novel.error ?? "" })}
        </p>
        <RouteLink navigate={navigate} to="/write" className={css.link}>
          {t("workspace.failed.back")}
        </RouteLink>
      </section>
    ) : (
      <p role="status" className={css.muted}>
        {t("workspace.loading")}
      </p>
    );
  return <NovelWorkspace {...props} novel={novel} project={novel.project} />;
}

function NovelWorkspace(
  props: NovelWorkspacePageProps & {
    novel: LegacyNovelWorkspace;
    project: NonNullable<LegacyNovelWorkspace["project"]>;
  },
) {
  const { t, navigate, renderSlot, workspace, system, novel, project } = props;
  const { search } = props.useRoute();
  const query = new URLSearchParams(search);
  const requestedSection = pick(SECTIONS, query.get("section"));
  const requestedOutline = pick(OUTLINE_MODES, query.get("outlineMode"));
  const manuscriptId = query.get("manuscriptId");
  const [section, setSection] = useState(requestedSection ?? "chapters");
  const [outlineMode, setOutlineMode] = useState(requestedOutline ?? "book");
  useEffect(() => {
    if (requestedSection) setSection(requestedSection);
  }, [requestedSection]);
  useEffect(() => {
    if (requestedOutline) setOutlineMode(requestedOutline);
  }, [requestedOutline]);
  const [manuscript, setManuscript] = useState<"markdown" | "json">();
  useEffect(() => {
    if (manuscriptId) setManuscript("markdown");
  }, [manuscriptId]);
  const [exporting, setExporting] = useState<ExportFormat>();
  const [exportNotice, setExportNotice] = useState<{
    tone: "success" | "danger";
    text: string;
  }>();
  const open = (next: LegacyNovelSection, mode?: LegacyOutlineMode) => {
    if (mode) setOutlineMode(mode);
    setSection(next);
  };
  const exportProject = async (format: ExportFormat) => {
    if (format === "submission-markdown" || format === "submission-json") {
      setManuscript(format === "submission-markdown" ? "markdown" : "json");
      return;
    }
    setExporting(format);
    setExportNotice(undefined);
    const document = await workspace.exportsProject(project.id, format);
    const saved = document.ok
      ? await system.saveTextFile({
          suggestedName: document.value.fileName,
          content: document.value.content,
        })
      : document;
    setExporting(undefined);
    setExportNotice(
      saved.ok
        ? {
            tone: "success",
            text: t(saved.value.saved ? "io.saved" : "io.cancelled"),
          }
        : { tone: "danger", text: saved.error.message },
    );
  };
  const owner = { record: novel.record, outlineMode, open };
  const tools = `/projects/${project.id}/tools`;
  return (
    <div className={css.workspace}>
      {manuscript &&
        renderSlot(
          "writing.manuscript",
          {
            projectId: project.id,
            format: manuscript,
            previewId: manuscriptId ?? undefined,
            onSaved: () =>
              setExportNotice({
                tone: "success",
                text: t("io.manuscript.saved"),
              }),
            onClose: () => {
              setManuscript(undefined);
              if (manuscriptId) {
                const next = new URLSearchParams(search);
                next.delete("manuscriptId");
                navigate(`/projects/${project.id}?${next}`);
              }
            },
          },
          { entryKey: "dialog" },
        )}
      <header className={css.bar}>
        <Button
          variant="ghost"
          size="sm"
          className={css.barButton}
          onClick={() => navigate("/write")}
        >
          {t("workspace.back")}
        </Button>
        <div className={css.barTitle}>
          <h1 className={css.projectName}>{project.title}</h1>
          <p className={css.barMeta}>
            {t("workspace.chapters", { count: novel.chapterCount })}
          </p>
        </div>
        <nav aria-label={t("workspace.nav")} className={css.sections}>
          {SECTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-current={section === value ? "page" : undefined}
              className={section === value ? css.sectionOn : css.section}
              onClick={() => setSection(value)}
            >
              {t(`section.${value}`)}
            </button>
          ))}
        </nav>
        <RouteLink navigate={navigate} to={tools} className={css.toolsLink}>
          {t("workspace.tools")}
        </RouteLink>
        <IoMenu
          t={t}
          exporting={exporting}
          onImport={() => navigate(`${tools}/import`)}
          onTools={() => navigate(tools)}
          onExport={(format) => void exportProject(format)}
        />
      </header>
      {(novel.error !== undefined || exportNotice) && (
        <div className={css.notices}>
          {novel.error !== undefined && (
            <p role="alert" className={css.danger}>
              {novel.error}
            </p>
          )}
          {exportNotice && (
            <p
              role={exportNotice.tone === "danger" ? "alert" : "status"}
              className={
                exportNotice.tone === "danger" ? css.danger : css.success
              }
            >
              {exportNotice.text}
            </p>
          )}
        </div>
      )}
      <ModeGuide t={t} navigate={navigate} mode={project.mode} to={tools} />
      {renderSlot("writing.banner", owner)}
      {section === "chapters" ? (
        <div className={css.chaptersBody}>
          {renderSlot("writing.section", owner, { entryKey: section })}
        </div>
      ) : (
        <div className={css.sectionBody}>
          <div className={css.sectionInner}>
            {renderSlot("writing.section", owner, { entryKey: section })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The import and export menu of the workspace header. */
function IoMenu(props: {
  t: NovelWorkspacePageProps["t"];
  exporting: ExportFormat | undefined;
  onImport(): void;
  onTools(): void;
  onExport(format: ExportFormat): void;
}) {
  const { t } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div ref={root} className={css.menuRoot}>
      <Button
        variant="outline"
        size="sm"
        className={css.barButtonRaised}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("io.menu")}
      </Button>
      {open && (
        <div role="menu" aria-label={t("io.menu")} className={css.menu}>
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            onClick={choose(props.onImport)}
          >
            {t("io.import")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            onClick={choose(props.onTools)}
          >
            {t("io.tools")}
          </button>
          {EXPORTS.map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className={css.menuItem}
              disabled={props.exporting !== undefined}
              onClick={choose(() => props.onExport(format))}
            >
              {props.exporting === format
                ? t("io.exporting")
                : t(`io.${format}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const GUIDE_DISMISSED_KEY = "dramaip-mode-guide-dismissed-v1";

function dismissedGuides(): string[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(GUIDE_DISMISSED_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** The per-mode workspace guide; once the author closes it, it stays closed. */
function ModeGuide(props: {
  t: NovelWorkspacePageProps["t"];
  navigate: (path: string) => void;
  mode: LegacyProjectMode;
  to: string;
}) {
  const { t, mode } = props;
  const [dismissed, setDismissed] = useState(() =>
    dismissedGuides().includes(mode),
  );
  if (dismissed) return null;
  return (
    <section className={css.guide}>
      <div className={css.guideInner}>
        <div className={css.guideText}>
          <p className={css.guideTitle}>{t(`guide.${mode}.title`)}</p>
          <p className={css.guideDetail}>{t(`guide.${mode}.detail`)}</p>
        </div>
        <RouteLink navigate={props.navigate} to={props.to} className={css.link}>
          {t(`guide.${mode}.action`)}
        </RouteLink>
        <Button
          variant="ghost"
          size="sm"
          className={css.guideClose}
          aria-label={t("guide.close")}
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(
                GUIDE_DISMISSED_KEY,
                JSON.stringify([...dismissedGuides(), mode]),
              );
            } catch {
              // Storage is a convenience; the guide still closes for this view.
            }
          }}
        >
          <span aria-hidden="true" className={css.close} />
        </Button>
      </div>
    </section>
  );
}
