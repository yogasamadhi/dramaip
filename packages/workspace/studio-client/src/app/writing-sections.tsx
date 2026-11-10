import type { Chapter, Project } from "@dramaip/contracts/product";
import { Button } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "./controls";
import { useQuery, useQueryClient } from "./query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "./router";
import { CreativeIntentSummary } from "./creative-intent";
import { ChapterAnalysisPanel } from "./features/creative/impl";
import { StoryIntelligencePanel } from "./features/creative/StoryIntelligencePanel";
import { ManuscriptExportDialog } from "./features/novel/ManuscriptExportDialog";
import { NarrativePlanningWorkbench } from "./features/novel/NarrativePlanningWorkbench";
import { NovelChapterWorkspace } from "./features/novel/NovelChapterWorkspace";
import {
  NovelCharactersSection,
  NovelLongformToolsSection,
  NovelOutlineSection,
  type NovelOutlineMode,
} from "./features/novel/NovelProjectSections";
import { StorySetupGenerator } from "./features/novel/StorySetupGenerator";
import { NovelPlanningGuide } from "./features/novel/NovelPlanningGuide";
import { NovelStoryPresetPicker } from "./features/novel/NovelStoryPresetPicker";
import {
  applyNovelStoryPresetToBrief,
  novelStoryPreset,
  novelStoryPresetForLabel,
  projectInputFromStoryPreset,
  storyPresetRefinementInstruction,
  type NovelStoryPresetId,
} from "./features/novel/story-presets";
import {
  CreativeDiagnosticsPanel,
  PluginResourceWorkspace,
  StoryBibleChangeSetPanel,
} from "./features/studio-widgets";
import {
  ContentVersionPanel,
  ProjectActivityPanel,
  ProjectSettingsEditor,
  StoryBibleSidecar,
} from "./features/workspace/impl";
import {
  novelWorkspaceReferenceKey,
  readNovelWorkspaceContext,
} from "./novel-workspace-context";
import {
  existingScriptContext,
  initializeProjectMaterials,
  ProjectInitializationError,
  scriptWorkspacePath,
} from "./project-creation-coordinator";
import {
  defaultProductionBrief,
  isDirectScriptProject,
  projectInputFromBrief,
  projectModeBrief,
  projectModeConfigFromDraft,
} from "./project-intake";
import { createCreationDraft, useStudioSession } from "./studio-session";
import {
  NOVEL_GENRE_CHOICES,
  message,
  useStudio,
  type EditableChapter,
  type EditableProject,
} from "./studio-shared";
import styles from "./writing-sections.module.css";
import { copyText } from "./copy";

/** The sections of the novel workspace. */
export const NOVEL_SECTIONS = [
  "plan",
  "chapters",
  "outlines",
  "characters",
  "settings",
  "story-bible",
  "more",
] as const;

export type NovelSection = (typeof NOVEL_SECTIONS)[number];

/** The project, its chapters and the chapter actions a section body works on. */
export interface NovelWorkspaceRecord {
  readonly project: Project;
  readonly chapters: Chapter[];
  readonly active: Chapter | undefined;
  selectChapter(chapterId: string): void;
  addChapter(): Promise<Chapter | undefined>;
  updateChapterById(
    chapterId: string,
    patch: Partial<EditableChapter>,
    baseVersion: number,
  ): Promise<Chapter>;
  removeChapter(chapter: Chapter): Promise<void>;
  reorderChapters(chapterIds: string[]): Promise<void>;
  updateProject(patch: EditableProject): Promise<void>;
  /** Read the project and its chapters again. */
  load(): Promise<void>;
}

/**
 * Read the project and the chapter the route names, keep the chapter
 * selection and run the chapter writes. A deep link reads only its own
 * project; a failed read never falls back to another project or chapter.
 * @param projectId - the project the route names.
 */
export function useNovelWorkspace(projectId: string) {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const referenceKey = novelWorkspaceReferenceKey(projectId, location.search);
  const requestedReference = useRef(referenceKey);
  requestedReference.current = referenceKey;
  const readRevision = useRef(0);
  const [loaded, setLoaded] = useState<{
    referenceKey: string;
    project: Project;
    chapters: Chapter[];
  }>();
  const [readError, setReadError] = useState<{
    referenceKey: string;
    detail: string;
  }>();
  const [writeError, setWriteError] = useState<typeof readError>();
  const failedRead =
    readError?.referenceKey === referenceKey ? readError.detail : undefined;
  const project =
    loaded?.referenceKey === referenceKey && !failedRead
      ? loaded.project
      : undefined;
  const chapters = project ? loaded!.chapters : [];
  const setProject = (value: Project): void => {
    setLoaded((current) =>
      current?.referenceKey === referenceKey &&
      requestedReference.current === referenceKey
        ? { ...current, project: value }
        : current,
    );
  };
  const setChapters = (
    value: Chapter[] | ((items: Chapter[]) => Chapter[]),
  ): void => {
    setLoaded((current) =>
      current?.referenceKey === referenceKey &&
      requestedReference.current === referenceKey
        ? {
            ...current,
            chapters:
              typeof value === "function" ? value(current.chapters) : value,
          }
        : current,
    );
  };
  const [activeId, setActiveId] = useState<string>();
  const error =
    failedRead ??
    (writeError?.referenceKey === referenceKey ? writeError.detail : undefined);
  const setError = (detail: string): void => {
    if (requestedReference.current === referenceKey)
      setWriteError({ referenceKey, detail });
  };
  const search = new URLSearchParams(location.search);
  const requestedSection = search.get("section");
  const requestedChapterId = search.get("chapterId");
  const active = chapters.find((item) => item.id === activeId) ?? chapters[0];
  const load = async (): Promise<void> => {
    if (!projectId || requestedReference.current !== referenceKey) return;
    const revision = ++readRevision.current;
    setReadError(undefined);
    try {
      const snapshot = await readNovelWorkspaceContext({
        projectId,
        search: location.search,
        getProject: client.projects.get,
        listChapters: client.chapters.list,
        getChapter: client.chapters.get,
      });
      if (
        requestedReference.current !== referenceKey ||
        readRevision.current !== revision
      )
        return;
      setLoaded({
        referenceKey,
        project: snapshot.project,
        chapters: snapshot.chapters,
      });
      setWriteError(undefined);
      const c = snapshot.chapters;
      if (snapshot.chapterId)
        window.localStorage.setItem(
          `dramaip-novel-last-chapter:${projectId}`,
          snapshot.chapterId,
        );
      setActiveId((current) => {
        const remembered = window.localStorage.getItem(
          `dramaip-novel-last-chapter:${projectId}`,
        );
        // Deep links only select chapters belonging to this actual project.
        if (snapshot.chapterId) return snapshot.chapterId;
        if (current && c.some((item) => item.id === current)) return current;
        if (remembered && c.some((item) => item.id === remembered))
          return remembered;
        return c[0]?.id;
      });
    } catch (cause) {
      if (
        requestedReference.current === referenceKey &&
        readRevision.current === revision
      )
        setReadError({ referenceKey, detail: message(cause) });
    }
  };
  useEffect(() => {
    void load();
    return () => {
      readRevision.current += 1;
    };
  }, [client, referenceKey]);
  const { data: restoredScriptContext } = useQuery({
    queryKey: [
      "existing-script-context",
      projectId,
      project?.currentAdaptationId,
    ],
    queryFn: () => existingScriptContext(client, project!),
    enabled:
      Boolean(project) &&
      project?.id === projectId &&
      Boolean(project && isDirectScriptProject(project)) &&
      !chapters.length &&
      !requestedSection,
  });
  useEffect(() => {
    if (restoredScriptContext && restoredScriptContext.projectId === projectId)
      navigate(scriptWorkspacePath(restoredScriptContext), { replace: true });
  }, [navigate, projectId, restoredScriptContext]);
  const selectChapter = (chapterId: string): void => {
    if (requestedReference.current !== referenceKey) return;
    setActiveId(chapterId);
    if (projectId)
      window.localStorage.setItem(
        `dramaip-novel-last-chapter:${projectId}`,
        chapterId,
      );
    // Preserve legacy query-free routes. When following an explicit chapter
    // link, keep that link aligned with subsequent directory selections.
    if (requestedChapterId) {
      const next = new URLSearchParams(location.search);
      next.set("chapterId", chapterId);
      navigate(
        { pathname: location.pathname, search: `?${next}` },
        { replace: true },
      );
    }
  };
  const record: NovelWorkspaceRecord | undefined = project && {
    project,
    chapters,
    active,
    selectChapter,
    addChapter: async () => {
      try {
        const created = await client.chapters.create({
          projectId,
          title: `第 ${chapters.length + 1} 章`,
          summary: "",
          content: "",
        });
        setChapters((items) => [...items, created]);
        selectChapter(created.id);
        return created;
      } catch (cause) {
        setError(message(cause));
        return undefined;
      }
    },
    updateChapterById: async (chapterId, patch, baseVersion) => {
      try {
        const updated = await client.chapters.update(chapterId, {
          ...patch,
          version: baseVersion,
        });
        setChapters((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        return updated;
      } catch (cause) {
        setError(message(cause));
        await load();
        throw cause;
      }
    },
    removeChapter: async (chapter) => {
      if (
        !(await confirmDialog(
          `确定删除「${chapter.title}」吗？此操作无法撤销。`,
        ))
      )
        return;
      try {
        await client.chapters.remove(chapter.id);
        const next = chapters.filter((item) => item.id !== chapter.id);
        setChapters(next);
        if (activeId === chapter.id && next[0]) selectChapter(next[0].id);
      } catch (cause) {
        setError(message(cause));
        void load();
      }
    },
    reorderChapters: async (chapterIds) => {
      try {
        setChapters(await client.chapters.reorder(projectId, { chapterIds }));
      } catch (cause) {
        setError(message(cause));
        await load();
      }
    },
    updateProject: async (patch) => {
      try {
        setProject(
          await client.projects.update(project.id, {
            ...patch,
            version: project.version,
          }),
        );
      } catch (cause) {
        setError(message(cause));
        void load();
      }
    },
    load,
  };
  return {
    status: project ? "ready" : failedRead ? "failed" : "loading",
    ...(error === undefined ? {} : { error }),
    ...(project
      ? {
          project: { id: project.id, title: project.title, mode: project.mode },
        }
      : {}),
    chapterCount: chapters.length,
    record: record ?? {},
  } as const;
}

/** The story preset a project was started from, while its brief still names it. */
function projectStoryPreset(project: Project) {
  const preset = novelStoryPresetForLabel(project.shortDramaType);
  return preset &&
    project.productionBrief?.includes(`故事预设：${preset.label}`)
    ? preset
    : undefined;
}

/** What a section body or banner of the novel workspace receives. */
export interface NovelSectionProps {
  readonly record: NovelWorkspaceRecord;
  readonly outlineMode: NovelOutlineMode;
  /** Show a section, and the outline mode with `outlines`. */
  open(section: NovelSection, outlineMode?: NovelOutlineMode): void;
}

/** The body of one novel workspace section. */
export function NovelSectionBody(
  props: NovelSectionProps & { section: NovelSection },
) {
  const client = useStudio();
  const { record, outlineMode } = props;
  const { project, chapters } = record;
  const storyPreset = projectStoryPreset(project);
  const refine = (
    part: Parameters<typeof storyPresetRefinementInstruction>[1],
  ) =>
    storyPreset
      ? storyPresetRefinementInstruction(storyPreset, part)
      : undefined;
  switch (props.section) {
    case "plan":
      return (
        <NovelPlanningGuide
          project={project}
          onOpen={(section) => props.open(section)}
          onProjectChanged={record.load}
        />
      );
    case "chapters":
      return (
        <NovelChapterWorkspace
          client={client}
          projectId={project.id}
          adaptationTarget={
            project.mode !== "series_longform" ||
            Boolean(project.currentAdaptationId)
          }
          chapters={chapters}
          activeChapter={record.active}
          onSelectChapter={record.selectChapter}
          onCreateChapter={record.addChapter}
          onSaveChapter={record.updateChapterById}
          onRemoveChapter={record.removeChapter}
          onReorderChapters={record.reorderChapters}
          onReload={record.load}
          renderStoryBibleSidecar={({ chapter, content }) => (
            <StoryBibleSidecar
              embedded
              projectId={project.id}
              context={{
                kind: "chapter",
                id: chapter.id,
                title: chapter.title,
                content,
                version: chapter.version,
              }}
            />
          )}
        />
      );
    case "settings":
      return (
        <div className={styles.c1}>
          <CreativeIntentSummary project={project} />
          <section className={styles.c2}>
            <div>
              <h2 className={styles.c3}>
                {copyText("app/writing-sections.1")}
              </h2>
              <p className={styles.c4}>{copyText("app/writing-sections.2")}</p>
            </div>
            <StorySetupGenerator
              projectId={project.id}
              title={copyText("app/writing-sections.3")}
              description="可以只写一句话，也可以补充目标读者、题材偏好和不希望出现的内容。"
              defaultInstruction={refine("project")}
              onCommitted={record.load}
            />
          </section>
          <ProjectSettingsEditor
            project={project}
            onSave={record.updateProject}
          />
        </div>
      );
    case "characters":
      return (
        <NovelCharactersSection
          client={client}
          projectId={project.id}
          defaultInstruction={refine("characters")}
        />
      );
    case "outlines":
      return (
        <NovelOutlineSection
          client={client}
          projectId={project.id}
          mode={outlineMode}
          onModeChange={(mode) => props.open("outlines", mode)}
          defaultInstruction={refine(outlineMode === "arc" ? "arc" : "outline")}
        />
      );
    case "story-bible":
      return <StoryBibleChangeSetPanel projectId={project.id} />;
    case "more":
      return (
        <div className={styles.c5}>
          <NovelLongformToolsSection
            client={client}
            projectId={project.id}
            chapters={chapters}
          />
          <ContentVersionPanel
            projectId={project.id}
            onRestored={record.load}
          />
          <ProjectActivityPanel projectId={project.id} />
          <ChapterAnalysisPanel />
          <CreativeDiagnosticsPanel />
          <PluginResourceWorkspace
            owner="automation"
            title={copyText("app/writing-sections.4")}
            projectId={project.id}
            domains={[
              "project-skills",
              "agent-schemes",
              "inspirations",
              "templates",
            ]}
          />
          <PluginResourceWorkspace
            owner="knowledge"
            title={copyText("app/writing-sections.5")}
            projectId={project.id}
            domains={["visual-settings"]}
          />
          <PluginResourceWorkspace
            owner="creative-quality"
            title={copyText("app/writing-sections.6")}
            projectId={project.id}
            domains={[
              "beats",
              "highlights",
              "feasibility",
              "trends",
              "evaluations",
            ]}
          />
        </div>
      );
  }
}

/** The banner offering the parts of a story preset still to fill in. */
export function StoryPresetBanner(props: NovelSectionProps) {
  const storyPreset = projectStoryPreset(props.record.project);
  if (!storyPreset) return null;
  return (
    <section
      className={styles.c6}
      aria-label={copyText("app/writing-sections.7")}
    >
      <div className={styles.c7}>
        <div className={styles.c8}>
          <p className={styles.c9}>
            {copyText("app/writing-sections.8")}
            {storyPreset.label}
            {copyText("app/writing-sections.9")}
          </p>
          <p className={styles.c10}>{copyText("app/writing-sections.10")}</p>
        </div>
        <div className={styles.c11}>
          {(
            [
              ["项目设定", "settings", undefined],
              ["人物", "characters", undefined],
              ["全书大纲", "outlines", "book"],
              ["故事弧", "outlines", "arc"],
            ] as const
          ).map(([label, section, mode]) => (
            <Button
              key={label}
              size="sm"
              variant="secondary"
              onClick={() => props.open(section, mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The manuscript export dialog of the novel workspace. */
export function NovelManuscriptDialog(props: {
  projectId: string;
  format: "markdown" | "json";
  previewId?: string | undefined;
  onSaved(): void;
  onClose(): void;
}) {
  return (
    <ManuscriptExportDialog
      projectId={props.projectId}
      format={props.format}
      {...(props.previewId === undefined ? {} : { previewId: props.previewId })}
      onSaved={props.onSaved}
      onClose={props.onClose}
    />
  );
}

/**
 * The novel quick start's draft, kept in the creation session so the author
 * can leave and come back, and its create action: create the project, set up
 * its first materials and open it (or its import tool).
 */
export function useNovelQuickStart() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const restored =
    session.creationDraft?.projectMode === "series_longform"
      ? session.creationDraft
      : undefined;
  const initialSource =
    requestedMode === "source"
      ? "source-import"
      : (restored?.creationSource ?? "inspiration");
  const initialBrief =
    restored?.brief ?? projectModeBrief("series_longform", initialSource);
  const [mode, setModeState] = useState<"inspiration" | "source">(
    initialSource === "source-import" ? "source" : "inspiration",
  );
  const [title, setTitleState] = useState(initialBrief.title);
  const [idea, setIdeaState] = useState(initialBrief.idea);
  const [genre, setGenreState] = useState<string>(initialBrief.shortDramaType);
  const [storyPresetId, setStoryPresetId] = useState<
    NovelStoryPresetId | undefined
  >(() =>
    novelStoryPreset(restored?.storyPresetId as NovelStoryPresetId)
      ? (restored?.storyPresetId as NovelStoryPresetId)
      : undefined,
  );
  const [replaceOtherDraft, setReplaceOtherDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const conflict = Boolean(
    session.creationDraft &&
    session.creationDraft.projectMode !== "series_longform" &&
    !replaceOtherDraft,
  );

  const persist = (values: {
    nextMode?: "inspiration" | "source";
    nextTitle?: string;
    nextIdea?: string;
    nextGenre?: string;
    nextPresetId?: NovelStoryPresetId | undefined;
  }) => {
    const nextMode = values.nextMode ?? mode;
    const source = nextMode === "source" ? "source-import" : "inspiration";
    const brief = projectModeBrief("series_longform", source, {
      ...initialBrief,
      title: values.nextTitle ?? title,
      idea: values.nextIdea ?? idea,
      shortDramaType: values.nextGenre ?? genre,
    });
    brief.shortDramaType = values.nextGenre ?? genre;
    const base = createCreationDraft(
      "novel-quick-start",
      "series_longform",
      source,
    );
    session.saveCreationDraft({
      ...base,
      ...restored,
      projectMode: "series_longform",
      creationSource: source,
      brief,
      storyPresetId: values.nextPresetId,
      scriptDraft: "",
      creatorTopic: "",
      origin: "novel-quick-start",
      updatedAt: new Date().toISOString(),
    });
  };

  const create = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    setError(undefined);
    let project: Project | undefined;
    try {
      let draft = defaultProductionBrief(
        mode === "source" ? "source-import" : "inspiration",
      );
      draft.title = title.trim();
      draft.idea = idea.trim();
      draft.shortDramaType = genre || "都市情感";
      const preset =
        mode === "inspiration" ? novelStoryPreset(storyPresetId) : undefined;
      if (preset) draft = applyNovelStoryPresetToBrief(draft, preset);
      const modeConfig = projectModeConfigFromDraft(
        "series_longform",
        draft.creationSource,
        draft,
        "",
      );
      if (!modeConfig) throw new Error("系列长篇规模设置无效。");
      const attemptId = session.creationDraft?.attemptId ?? crypto.randomUUID();
      const saveDraft = (extra: object) =>
        session.saveCreationDraft(
          {
            ...(session.creationDraft ??
              createCreationDraft(
                "novel-quick-start",
                "series_longform",
                draft.creationSource,
              )),
            brief: draft,
            storyPresetId,
            attemptId,
            ...extra,
            updatedAt: new Date().toISOString(),
          },
          true,
        );
      saveDraft({});
      project = (
        await client.projects.create(
          preset
            ? projectInputFromStoryPreset(draft, preset, modeConfig)
            : projectInputFromBrief(draft, modeConfig),
          attemptId,
        )
      ).project;
      saveDraft({ createdProjectId: project.id });
      try {
        const initialized = await initializeProjectMaterials(client, {
          project,
          brief: draft,
          preset,
        });
        saveDraft({
          createdProjectId: project.id,
          initializationSteps: initialized.steps,
        });
        if (initialized.chapterId)
          window.localStorage.setItem(
            `dramaip-novel-last-chapter:${project.id}`,
            initialized.chapterId,
          );
      } catch (cause) {
        if (cause instanceof ProjectInitializationError)
          saveDraft({
            createdProjectId: project.id,
            initializationSteps: cause.steps,
          });
        throw cause;
      }
      session.clearCreationDraft();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(
        mode === "source"
          ? `/projects/${project.id}/tools/import`
          : `/projects/${project.id}`,
      );
    } catch (cause) {
      setError(
        project
          ? `${message(cause)} 项目和已完成资料均已保留，可安全重试。`
          : message(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    conflict,
    mode,
    title,
    idea,
    genre,
    genres: NOVEL_GENRE_CHOICES as readonly string[],
    saving,
    ...(error === undefined ? {} : { error }),
    replaceOtherDraft: () => {
      session.clearCreationDraft();
      setReplaceOtherDraft(true);
    },
    setMode: (value: "inspiration" | "source") => {
      setModeState(value);
      if (value === "source") {
        setStoryPresetId(undefined);
        setGenreState("都市情感");
      }
      persist({
        nextMode: value,
        nextGenre: value === "source" ? "都市情感" : genre,
        nextPresetId: undefined,
      });
    },
    setTitle: (value: string) => {
      setTitleState(value);
      persist({ nextTitle: value, nextPresetId: storyPresetId });
    },
    setIdea: (value: string) => {
      setIdeaState(value);
      persist({ nextIdea: value, nextPresetId: storyPresetId });
    },
    setGenre: (value: string) => {
      setStoryPresetId(undefined);
      setGenreState(value);
      persist({ nextGenre: value, nextPresetId: undefined });
    },
    create: () => void create(),
    record: {
      presetId: storyPresetId,
      choose: (id: string | undefined) => {
        if (id === undefined) {
          setStoryPresetId(undefined);
          setGenreState("都市情感");
          persist({ nextGenre: "都市情感", nextPresetId: undefined });
          return;
        }
        const preset = novelStoryPreset(id as NovelStoryPresetId);
        if (!preset) return;
        setStoryPresetId(id as NovelStoryPresetId);
        setGenreState(preset.label);
        persist({
          nextGenre: preset.label,
          nextPresetId: id as NovelStoryPresetId,
        });
      },
    } satisfies NovelPresetRecord,
  } as const;
}

/** The quick start's story preset choice, as its picker receives it. */
export interface NovelPresetRecord {
  readonly presetId: string | undefined;
  /** Choose a preset; `undefined` clears the choice. */
  choose(id: string | undefined): void;
}

/** The story preset picker of the novel quick start. */
export function NovelPresetPicker(props: { record: NovelPresetRecord }) {
  return (
    <NovelStoryPresetPicker
      selectedId={props.record.presetId as NovelStoryPresetId | undefined}
      onSelect={(id) => props.record.choose(id)}
      onClear={() => props.record.choose(undefined)}
    />
  );
}

/** The sections of the creative analysis page, in their order. */
export const CREATIVE_SECTIONS = [
  "planning",
  "change-sets",
  "chapter-analysis",
  "diagnostics",
  "intelligence",
  "resources",
] as const;

export type CreativeSection = (typeof CREATIVE_SECTIONS)[number];

/** One section of the creative analysis page. */
export function CreativeSectionBody(props: {
  section: CreativeSection;
  projectId: string | undefined;
  changeSetId: string | null;
}) {
  const { projectId } = props;
  switch (props.section) {
    case "planning":
      return projectId ? (
        <NarrativePlanningWorkbench
          projectId={projectId}
          operation="knowledge-plan"
        />
      ) : null;
    case "change-sets":
      return (
        <details
          key={props.changeSetId ?? "all-changes"}
          open={props.changeSetId ? true : undefined}
          className={styles.c12}
        >
          <summary className={styles.c13}>
            {copyText("app/writing-sections.11")}
          </summary>
          <StoryBibleChangeSetPanel projectId={projectId} />
        </details>
      );
    case "chapter-analysis":
      return <ChapterAnalysisPanel projectId={projectId} />;
    case "diagnostics":
      return <CreativeDiagnosticsPanel projectId={projectId} />;
    case "intelligence":
      return (
        <StoryIntelligencePanel
          key={projectId ?? "no-project"}
          projectId={projectId}
        />
      );
    case "resources":
      return (
        <details className={styles.c12}>
          <summary className={styles.c13}>
            {copyText("app/writing-sections.12")}
          </summary>
          <PluginResourceWorkspace
            owner="writing"
            title={copyText("app/writing-sections.13")}
            domains={["characters", "outlines", "story-arcs"]}
            projectId={projectId}
          />
          <PluginResourceWorkspace
            owner="knowledge"
            title={copyText("app/writing-sections.14")}
            domains={[
              "story",
              "memory",
              "chapter-memories",
              "character-states",
              "visual-profiles",
              "visual-settings",
              "story-events",
              "foreshadowings",
            ]}
            projectId={projectId}
          />
          <PluginResourceWorkspace
            owner="automation"
            title={copyText("app/writing-sections.15")}
            domains={[
              "project-skills",
              "agent-schemes",
              "inspirations",
              "templates",
            ]}
            projectId={projectId}
          />
          <PluginResourceWorkspace
            owner="creative-quality"
            title={copyText("app/writing-sections.6")}
            domains={[
              "analysis",
              "beats",
              "highlights",
              "feasibility",
              "trends",
              "evaluations",
            ]}
            projectId={projectId}
          />
        </details>
      );
  }
}
