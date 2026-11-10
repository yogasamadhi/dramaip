/**
 * Slot contract of the transitional Studio client (P4-a, deleted in P6): the
 * pages the domain client plugins take over still render inside the existing
 * app's router, at the route path they register under.
 * @module @dramaip/workspace-studio-client/client/contract
 */
import type { ReactNode } from "react";
import type {} from "@deepseek-ai/cordis";
import type { CreationStartInput } from "@dramaip/automation-automation/types";
import type {} from "@dramaip/infra-ui-slots";

declare module "@deepseek-ai/cordis" {
  interface Events {
    /**
     * The model provider that last passed its connection test or was made
     * the assistant's, or `undefined` after a save. The agents client's AI
     * section announces it; the app's creation checklist, still in the
     * existing app, names the next step from it.
     * @param providerId - the provider, or none.
     * @mode emit
     */
    "studio/provider-ready"(providerId: string | undefined): void;
  }
}

declare module "@dramaip/infra-ui-slots" {
  interface SlotFactoryMap {
    /**
     * The production source picker a new production creation run starts
     * from: it settles on a production narrative and renders `children`
     * with it. The automation client's creation workbench renders it; the
     * existing app's picker fills it until it moves with the production
     * views (P6), so it renders only inside the app's providers.
     */
    "production.narrative-sources": {
      scope: "root";
      props: ProductionNarrativeSourcesProps;
    };
  }

  interface SlotMap {
    /**
     * One page per route path the existing app hands over (key = the path,
     * such as `/settings`). Declared by the Studio client's root entry; the
     * page renders inside the app's providers, so the app's own sections
     * registered into the page's child slots keep their data context.
     */
    "studio.route": {
      kind: "keyed";
      scope: "root";
      owner: LegacyRouteOwnerProps;
    };
    /**
     * The body of one project tool (key = the tool, such as `import`).
     * Declared by the workspace client's project tools page when it mounts;
     * the app's tool panels register here until they move with their
     * domains. Declared in this contract while the app owns those panels,
     * so the workspace client keeps its only dependency on this package; it
     * moves to the workspace client in P6.
     */
    "workspace.tool": {
      kind: "keyed";
      scope: "root";
      owner: WorkspaceToolOwnerProps;
    };
    /**
     * The body of one section of the novel workspace (key = the section,
     * such as `chapters`). Declared by the writing client's workspace page
     * when it mounts; the app's chapter editor and section panels register
     * here until they move. Declared in this contract for the reason
     * `workspace.tool` is; it moves to the writing client in P6.
     */
    "writing.section": {
      kind: "keyed";
      scope: "root";
      owner: WritingSectionOwnerProps;
    };
    /** Banners above the novel workspace's sections, in `order`. */
    "writing.banner": {
      kind: "list";
      scope: "root";
      owner: WritingSectionOwnerProps;
    };
    /** The manuscript export dialog of the novel workspace (key `dialog`). */
    "writing.manuscript": {
      kind: "keyed";
      scope: "root";
      owner: WritingManuscriptOwnerProps;
    };
    /** The story preset picker of the novel quick start (key `picker`). */
    "writing.preset": {
      kind: "keyed";
      scope: "root";
      owner: WritingPresetOwnerProps;
    };
    /**
     * One section of the creative analysis page, in `order`. Declared by the
     * quality client's page when it mounts, like `writing.section`.
     */
    "quality.section": {
      kind: "list";
      scope: "root";
      owner: QualitySectionOwnerProps;
    };
    /**
     * The project conversion of an inspiration conversation (key `panel`),
     * under its cards. Declared by the agents client's inspiration space
     * when it mounts; the app's conversion registers here until project
     * creation moves with the workspace views. Declared in this contract
     * for the reason `workspace.tool` is.
     */
    "agents.inspiration-conversion": {
      kind: "keyed";
      scope: "root";
      owner: InspirationConversionOwnerProps;
    };
    /**
     * The production workbench (key `body`). Declared by the media client's
     * page frame when it mounts; the app's workbench registers here until it
     * moves. Declared in this contract for the reason `workspace.tool` is.
     */
    "media.produce": {
      kind: "keyed";
      scope: "root";
      owner: MediaPageOwnerProps;
    };
    /**
     * The media object a review link returns to (key `body`), which heads
     * itself with the copy its owner hands it.
     */
    "media.review": {
      kind: "keyed";
      scope: "root";
      owner: MediaReviewOwnerProps;
    };
    /**
     * The adaptation workbench (key `body`), which heads itself with the copy
     * its owner hands it for the kind of project it opens. Declared by the
     * production client's page frame.
     */
    "production.adapt": {
      kind: "keyed";
      scope: "root";
      owner: ProductionAdaptOwnerProps;
    };
  }
}

/** The project a handed-over page reads, kept in step with the app. */
export interface LegacyProjectScope {
  /** The projects to choose from, in the app's order. */
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  /** The chosen project; empty when none is chosen. */
  readonly projectId: string;
  /** Choose a project (empty clears the choice) and make it the active one. */
  select(projectId: string): void;
}

/** A record a scope choice offers. */
export interface LegacyScopeRecord {
  readonly id: string;
  readonly title: string;
}

/**
 * The project and production objects the app's route names, checked before
 * a page renders a body.
 */
export interface LegacyProductionScope {
  /** `checking` until the references are read; `failed` when one does not hold. */
  readonly status: "checking" | "failed" | "ready";
  /** The named project, else the active one; empty when there is none. */
  readonly projectId: string;
  /** Opaque: handed back to `useEpisodeScope`. */
  readonly context: object;
  /** Changes whenever the route names other objects. */
  readonly key: string;
}

/** The route values an episode-scoped page keeps in its address. */
export interface LegacyEpisodeRoute {
  readonly projectId?: string;
  readonly adaptationId?: string;
  readonly episodeId?: string;
  readonly stage?: string;
}

/** The project, adaptation and episode an episode-scoped page works on. */
export interface LegacyEpisodeScope {
  readonly projects: readonly LegacyScopeRecord[];
  readonly projectId: string;
  readonly adaptations: readonly LegacyScopeRecord[];
  readonly adaptationId: string;
  readonly episodes: readonly LegacyScopeRecord[];
  readonly episodeId: string;
  /** The stage the address asks for, if any. */
  readonly requestedStage: string | null;
  /** Choose a project; clears the adaptation and episode choice. */
  selectProject(projectId: string): void;
  /** Choose an adaptation; clears the episode choice. */
  selectAdaptation(adaptationId: string): void;
  selectEpisode(episodeId: string): void;
  /** Write the page's choice into its address. */
  sync(next: LegacyEpisodeRoute): void;
}

/** The address of the app's current route. */
export interface LegacyRoute {
  /** The path parameters of the route the page registered under. */
  readonly params: Readonly<Record<string, string | undefined>>;
  /** The query, with its `?`, or empty. */
  readonly search: string;
}

/** The project modes a project tools page lays its tools out by. */
export type LegacyProjectMode =
  "series_longform" | "single_season" | "personal_theater" | "creator_channel";

/** One project as the app reads it for a project-scoped page. */
export interface LegacyProjectRecord {
  /** `loading` until the first read; `failed` when it did not hold. */
  readonly status: "loading" | "failed" | "ready";
  /** The last read's failure; set with `failed`, or after a failed re-read. */
  readonly error?: string;
  readonly project?: {
    readonly id: string;
    readonly title: string;
    readonly mode: LegacyProjectMode;
    /** A single season started from a script or an idea. */
    readonly directScript: boolean;
  };
  readonly chapterCount: number;
  /** Read the project and its chapters again. */
  reload(): Promise<void>;
  /** Opaque: handed to the bodies the page lays out. */
  readonly record: object;
}

/** The sections of the novel workspace. */
export type LegacyNovelSection =
  | "plan"
  | "chapters"
  | "outlines"
  | "characters"
  | "settings"
  | "story-bible"
  | "more";

/** How the novel workspace's outline section lays the outline out. */
export type LegacyOutlineMode = "book" | "chapter" | "arc";

/** The project and chapter the novel workspace's route names. */
export interface LegacyNovelWorkspace {
  /** `loading` until the first read; `failed` when a reference did not hold. */
  readonly status: "loading" | "failed" | "ready";
  /** The read's failure with `failed`; the last write's failure otherwise. */
  readonly error?: string;
  readonly project?: {
    readonly id: string;
    readonly title: string;
    readonly mode: LegacyProjectMode;
  };
  readonly chapterCount: number;
  /** Opaque: handed to the sections the page lays out. */
  readonly record: object;
}

/** The novel quick start's draft and its create action. */
export interface LegacyNovelQuickStart {
  /** Another mode's unfinished draft is kept; the form waits for a choice. */
  readonly conflict: boolean;
  readonly mode: "inspiration" | "source";
  readonly title: string;
  readonly idea: string;
  readonly genre: string;
  /** The genres to offer. */
  readonly genres: readonly string[];
  readonly saving: boolean;
  readonly error?: string;
  /** Drop the other mode's draft and start a new one here. */
  replaceOtherDraft(): void;
  setMode(mode: "inspiration" | "source"): void;
  setTitle(title: string): void;
  setIdea(idea: string): void;
  setGenre(genre: string): void;
  create(): void;
  /** Opaque: handed to the story preset picker. */
  readonly record: object;
}

/** The AI action waiting to resume after settings, and how to keep one. */
export interface LegacyAssistantIntent {
  readonly current:
    | { readonly actionId: string; readonly input?: string | undefined }
    | undefined;
  clear(): void;
  save(intent: {
    returnTo: string;
    projectId?: string;
    chapterId?: string;
    actionId: string;
    input?: string;
  }): void;
}

/** Owner share of a handed-over page. */
export interface LegacyRouteOwnerProps {
  /** Move the existing app's router to another of its paths. */
  navigate: (path: string) => void;
  /** Hook reading the app's current route. */
  useRoute: () => LegacyRoute;
  /**
   * Hook reading one project and its chapters, read again when the project
   * changes.
   */
  useProjectRecord: (projectId: string) => LegacyProjectRecord;
  /**
   * Hook reading the project and chapter the novel workspace's route names,
   * keeping the chapter choice and running the chapter writes.
   */
  useNovelWorkspace: (projectId: string) => LegacyNovelWorkspace;
  /** Hook holding the novel quick start's draft. */
  useNovelQuickStart: () => LegacyNovelQuickStart;
  /**
   * Hook reading the app's project list and active project. The page renders
   * inside the app's providers, so it calls this as one of its own hooks.
   */
  useProjectScope: () => LegacyProjectScope;
  /** Hook reading and checking the objects the app's route names. */
  useProductionScope: () => LegacyProductionScope;
  /**
   * Hook reading the AI action the author left for settings to fix, which
   * the app keeps across pages until it is resumed or expires.
   */
  useAssistantIntent: () => LegacyAssistantIntent;
  /**
   * Hook choosing the adaptation and episode inside a checked production
   * scope; `path` is the page's route, which `sync` writes.
   */
  useEpisodeScope: (
    path: string,
    scope: Pick<LegacyProductionScope, "projectId" | "context">,
  ) => LegacyEpisodeScope;
}

/** Owner share of a project tool body. */
export interface WorkspaceToolOwnerProps {
  readonly projectId: string;
  /** The page's `LegacyProjectRecord.record`. */
  readonly record: object;
  /** The route's query, with its `?`, or empty. */
  readonly search: string;
  /** Read the page's project and its chapters again. */
  reload(): Promise<void>;
  /** Move the existing app's router to another of its paths. */
  navigate(path: string): void;
}

/** Owner share of a novel workspace section or banner. */
export interface WritingSectionOwnerProps {
  /** The page's `LegacyNovelWorkspace.record`. */
  readonly record: object;
  readonly outlineMode: LegacyOutlineMode;
  /** Show a section, and the outline mode with `outlines`. */
  open(section: LegacyNovelSection, outlineMode?: LegacyOutlineMode): void;
}

/** Owner share of the manuscript export dialog. */
export interface WritingManuscriptOwnerProps {
  readonly projectId: string;
  readonly format: "markdown" | "json";
  /** The saved preview the address names, if any. */
  readonly previewId: string | undefined;
  onSaved(): void;
  onClose(): void;
}

/** Owner share of the story preset picker. */
export interface WritingPresetOwnerProps {
  /** The page's `LegacyNovelQuickStart.record`. */
  readonly record: object;
}

/** Owner share of a creative analysis section. */
export interface QualitySectionOwnerProps {
  /** The project the address names, else the active one. */
  readonly projectId: string | undefined;
  /** The story bible change set the address names, if any. */
  readonly changeSetId: string | null;
}

/** What an inspiration conversation hands its project conversion. */
export interface InspirationConversionOwnerProps {
  /** The open conversation. */
  readonly conversationId: string;
  /** Its title, which the conversion suggests as the project name. */
  readonly conversationTitle: string | undefined;
  /** The conversation's cards; only adopted ones are copied. */
  readonly cards: readonly {
    readonly id: string;
    readonly content: string;
    readonly adopted: boolean;
  }[];
  /** Show a notice under the conversation. */
  notify(message: string): void;
}

/** The production workbench reads its scope from the address itself. */
export type MediaPageOwnerProps = Readonly<Record<string, never>>;

/** The heading copy the media review return places inside its own section. */
export interface MediaReviewOwnerProps {
  readonly title: string;
  readonly description: string;
}

/** One heading of the adaptation workbench. */
export interface ProductionAdaptIntro {
  readonly title: string;
  readonly description: string;
}

/**
 * The heading copy of the adaptation workbench, per kind of project: one
 * developed from a story, or an original script written from an idea.
 */
export interface ProductionAdaptOwnerProps {
  readonly intro: Readonly<Record<"story" | "script", ProductionAdaptIntro>>;
}

/** The production narrative a source picker settled on. */
export interface ProductionNarrativeSelection {
  request?: CreationStartInput["productionNarrativeRequest"];
  /** The choice is not confirmed, so no run may start yet. */
  startDisabled: boolean;
}

/** Input of the production source picker. */
export interface ProductionNarrativeSourcesProps {
  projectId: string;
  /** Where the picker keeps the author's choice on this device. */
  storageKey: string;
  /** The plain source ids the caller had, shown as the compatible sources. */
  legacySourceIds?: string[] | undefined;
  disabled?: boolean | undefined;
  children: (selection: ProductionNarrativeSelection) => ReactNode;
}
