import type { Project, ProjectMode } from "@dramaip/contracts/product";
import {
  ProjectGoalConfirmationInputSchema,
  type ProjectInput,
  type ProjectGoalConfirmationInput,
} from "@dramaip/contracts/workspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  defaultProductionBrief,
  type ProductionBriefDraft,
  type ProjectCreationSource,
} from "./project-intake";
import { useStudioClient } from "./runtime-connection";
export { hasExactObjectReference } from "./exact-object-navigation";
import { hasExactObjectReference } from "./exact-object-navigation";
import { productionContextKeys } from "./production-object-context";
import {
  NativeScriptIntakeBindingSchema,
  type NativeScriptIntakeBinding,
} from "./native-script-intake";
import type {
  SourceImportAttempt,
  SourceImportDraft,
} from "./source-import-binding";

const CREATION_DRAFT_KEY = "dramaip-creation-draft:v1";
const ACTIVE_PROJECT_KEY = "dramaip-active-project:v1";
const PENDING_INTENT_KEY = "dramaip-pending-navigation-intent:v1";
const PENDING_INTENT_MAX_AGE = 24 * 60 * 60 * 1_000;

export type CreationDraftOrigin =
  "project-home" | "novel-quick-start" | "inspiration";

export type CreationInitializationStep = {
  key: string;
  status: "pending" | "completed" | "failed";
  message?: string;
};

export type CreationDraftV1 = {
  schemaVersion: 1;
  draftId: string;
  projectMode: ProjectMode;
  creationSource: ProjectCreationSource;
  brief: ProductionBriefDraft;
  storyPresetId?: string;
  scriptDraft: string;
  creatorTopic: string;
  origin: CreationDraftOrigin;
  intakeStep?: 1 | 2 | 3;
  attemptId?: string;
  goalConfirmation?: ProjectGoalConfirmationInput;
  frozenProjectInput?: ProjectInput;
  createdProjectId?: string;
  initializationSteps: CreationInitializationStep[];
  nativeScriptIntake?: NativeScriptIntakeBinding;
  pendingSourceImport?: SourceImportDraft;
  sourceImportAttempt?: SourceImportAttempt;
  updatedAt: string;
};

export type ProjectWorkspaceContextV2 = {
  route: string;
  workArea: "overview" | "story" | "adapt" | "produce" | "review" | "tools";
  chapterId?: string;
  adaptationId?: string;
  episodeId?: string;
  scriptId?: string;
  sceneId?: string;
  shotId?: string;
  updatedAt: string;
};

export type ActiveProjectStateV2 = {
  schemaVersion: 2;
  projectId?: string;
  lastRouteByProject: Record<string, string>;
  contextByProject: Record<string, ProjectWorkspaceContextV2>;
  updatedAt: string;
};

export type PendingNavigationIntentV1 = {
  schemaVersion: 1;
  kind: "ai-action";
  returnTo: string;
  projectId?: string;
  chapterId?: string;
  actionId: string;
  input?: string;
  createdAt: string;
};

export function createCreationDraft(
  origin: CreationDraftOrigin,
  projectMode: ProjectMode = "series_longform",
  creationSource: ProjectCreationSource = "inspiration",
): CreationDraftV1 {
  return {
    schemaVersion: 1,
    draftId: crypto.randomUUID(),
    projectMode,
    creationSource,
    brief: defaultProductionBrief(creationSource),
    scriptDraft: "",
    creatorTopic: "",
    origin,
    initializationSteps: [],
    updatedAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseCreationDraft(
  value: string | null,
): CreationDraftV1 | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.draftId !== "string" ||
      ![
        "series_longform",
        "single_season",
        "personal_theater",
        "creator_channel",
      ].includes(String(parsed.projectMode)) ||
      !["inspiration", "source-import", "script"].includes(
        String(parsed.creationSource),
      ) ||
      !isRecord(parsed.brief) ||
      typeof parsed.scriptDraft !== "string" ||
      typeof parsed.creatorTopic !== "string" ||
      !["project-home", "novel-quick-start", "inspiration"].includes(
        String(parsed.origin),
      ) ||
      (parsed.intakeStep !== undefined &&
        (typeof parsed.intakeStep !== "number" ||
          ![1, 2, 3].includes(parsed.intakeStep))) ||
      !Array.isArray(parsed.initializationSteps) ||
      (parsed.nativeScriptIntake !== undefined &&
        !NativeScriptIntakeBindingSchema.safeParse(parsed.nativeScriptIntake)
          .success) ||
      typeof parsed.updatedAt !== "string"
    )
      return undefined;
    // Invalid new proof is not inferred from old mode/step fields. Preserve any
    // ambiguous creation key and raw frozen input; the write boundary validates
    // the latter and must not silently erase recovery identity on parse failure.
    const confirmation = ProjectGoalConfirmationInputSchema.safeParse(
      parsed.goalConfirmation,
    );
    return {
      ...parsed,
      goalConfirmation: confirmation.success ? confirmation.data : undefined,
    } as CreationDraftV1;
  } catch {
    return undefined;
  }
}

export function parseActiveProjectState(
  value: string | null,
): ActiveProjectStateV2 | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      ![1, 2].includes(Number(parsed.schemaVersion)) ||
      !isRecord(parsed.lastRouteByProject) ||
      typeof parsed.updatedAt !== "string"
    )
      return undefined;
    if (parsed.schemaVersion === 1)
      return {
        schemaVersion: 2,
        ...(typeof parsed.projectId === "string"
          ? { projectId: parsed.projectId }
          : {}),
        lastRouteByProject: parsed.lastRouteByProject as Record<string, string>,
        contextByProject: {},
        updatedAt: parsed.updatedAt as string,
      };
    if (!isRecord(parsed.contextByProject)) return undefined;
    return parsed as ActiveProjectStateV2;
  } catch {
    return undefined;
  }
}

export function workspaceContextFromRoute(input: {
  pathname: string;
  search: string;
}): ProjectWorkspaceContextV2 | undefined {
  const projectId = projectIdFromLocation(input);
  if (!projectId) return undefined;
  const route = safeLocalRoute(`${input.pathname}${input.search}`);
  if (!route) return undefined;
  const params = new URLSearchParams(input.search);
  const workArea: ProjectWorkspaceContextV2["workArea"] =
    input.pathname.startsWith("/adapt")
      ? "adapt"
      : input.pathname.startsWith("/produce")
        ? "produce"
        : input.pathname.startsWith("/review")
          ? "review"
          : input.pathname.includes("/tools/")
            ? "tools"
            : input.pathname.startsWith("/projects/") ||
                input.pathname.startsWith("/write")
              ? "story"
              : "overview";
  const optional = (key: string): string | undefined =>
    params.get(key) || undefined;
  return {
    route,
    workArea,
    ...(optional("chapterId") ? { chapterId: optional("chapterId") } : {}),
    ...(optional("adaptationId")
      ? { adaptationId: optional("adaptationId") }
      : {}),
    ...(optional("episodeId") ? { episodeId: optional("episodeId") } : {}),
    ...(optional("scriptId") ? { scriptId: optional("scriptId") } : {}),
    ...(optional("sceneId") ? { sceneId: optional("sceneId") } : {}),
    ...(optional("shotId") ? { shotId: optional("shotId") } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function safeLocalRoute(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return undefined;
  const pathname = value.split("?")[0] ?? "";
  if (
    pathname === "/" ||
    pathname === "/write" ||
    pathname === "/write/new" ||
    pathname === "/create" ||
    pathname === "/adapt" ||
    pathname === "/produce" ||
    pathname === "/review" ||
    pathname === "/tasks" ||
    pathname === "/pending" ||
    pathname === "/inspiration" ||
    pathname === "/settings" ||
    pathname === "/search" ||
    /^\/projects\/[^/]+(?:\/tools\/[^/]+)?$/.test(pathname)
  )
    return value;
  return undefined;
}

export function parsePendingNavigationIntent(
  value: string | null,
  now = Date.now(),
): PendingNavigationIntentV1 | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const createdAt =
      isRecord(parsed) && typeof parsed.createdAt === "string"
        ? Date.parse(parsed.createdAt)
        : Number.NaN;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      parsed.kind !== "ai-action" ||
      typeof parsed.actionId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(createdAt) ||
      !safeLocalRoute(
        typeof parsed.returnTo === "string" ? parsed.returnTo : undefined,
      ) ||
      now - createdAt > PENDING_INTENT_MAX_AGE
    )
      return undefined;
    return parsed as PendingNavigationIntentV1;
  } catch {
    return undefined;
  }
}

export function hasExactWorkflowReference(search: string): boolean {
  return Boolean(new URLSearchParams(search).get("workflowId")?.trim());
}
export function hasExactWorkspaceReference(input: {
  pathname: string;
  search: string;
}): boolean {
  return (
    hasExactObjectReference(input.search) ||
    (/^\/projects\/[^/]+$/.test(input.pathname) &&
      new URLSearchParams(input.search).has("chapterId")) ||
    (["/adapt", "/produce", "/review"].includes(input.pathname) &&
      new URLSearchParams(input.search).has("projectId"))
  );
}
export function projectIdFromLocation(input: {
  pathname: string;
  search: string;
}): string | undefined {
  const fromQuery = new URLSearchParams(input.search).get("projectId");
  if (fromQuery) return fromQuery;
  const match = /^\/projects\/([^/?]+)/.exec(input.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function resolveActiveProjectId(input: {
  projects: readonly Project[];
  routeProjectId?: string;
  storedProjectId?: string;
  preserveRouteIdentity?: boolean;
}): string | undefined {
  if (input.preserveRouteIdentity && input.routeProjectId)
    return input.routeProjectId;
  if (
    input.routeProjectId &&
    input.projects.some((project) => project.id === input.routeProjectId)
  )
    return input.routeProjectId;
  if (
    input.storedProjectId &&
    input.projects.some((project) => project.id === input.storedProjectId)
  )
    return input.storedProjectId;
  return [...input.projects].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )[0]?.id;
}

export function contextualNavigationTarget(
  target: string,
  projectId?: string,
  context?: ProjectWorkspaceContextV2,
): string {
  if (!projectId) return target;
  if (target === "/write") return `/projects/${encodeURIComponent(projectId)}`;
  if (!["/create", "/adapt", "/produce", "/review", "/tasks"].includes(target))
    return target;
  const search = new URLSearchParams({ projectId });
  if (["/adapt", "/produce", "/review"].includes(target) && context) {
    const [pathname = "", originalSearch = ""] = context.route.split("?");
    // Session data is an unverified navigation hint. Reparse a local, owned
    // Production route; never forward a formal tool's stable episode key,
    // workflow/candidate, stage, body, or authority to a resource workspace.
    if (
      ["/adapt", "/produce", "/review"].includes(pathname) &&
      projectIdFromLocation({ pathname, search: originalSearch }) === projectId
    ) {
      const params = new URLSearchParams(originalSearch);
      for (const key of productionContextKeys) {
        for (const value of params.getAll(key)) search.append(key, value);
      }
    }
  }
  return `${target}?${search}`;
}

export function rememberedWorkspaceContext(
  previous: ProjectWorkspaceContextV2 | undefined,
  next: ProjectWorkspaceContextV2,
): ProjectWorkspaceContextV2 {
  // Project overview/tools/tasks must not erase the previous resource choice.
  // A new resource route replaces the hint, including explicit bad references;
  // owner validation at the destination prevents silently opening another one.
  const hasProductionReference = (value: ProjectWorkspaceContextV2) =>
    ["adapt", "produce", "review"].includes(value.workArea) &&
    productionContextKeys.some((key) =>
      new URLSearchParams(value.route.split("?")[1]).has(key),
    );
  return previous &&
    hasProductionReference(previous) &&
    !hasProductionReference(next)
    ? previous
    : next;
}

type StudioSessionValue = {
  projects: Project[];
  projectsLoading: boolean;
  activeProjectId?: string;
  activeProject?: Project;
  activeProjectNotice?: string;
  selectProject(projectId: string): void;
  rememberProjectRoute(projectId: string, route: string): void;
  rememberProductionObjectContext(
    projectId: string,
    references: Partial<Record<(typeof productionContextKeys)[number], string>>,
  ): void;
  lastProjectRoute(projectId: string): string | undefined;
  projectContext(projectId: string): ProjectWorkspaceContextV2 | undefined;
  creationDraft?: CreationDraftV1;
  saveCreationDraft(draft: CreationDraftV1, preserveAttempt?: boolean): void;
  clearCreationDraft(): void;
  pendingIntent?: PendingNavigationIntentV1;
  savePendingIntent(
    intent: Omit<PendingNavigationIntentV1, "schemaVersion" | "createdAt">,
  ): void;
  clearPendingIntent(): void;
};

const StudioSessionContext = createContext<StudioSessionValue | undefined>(
  undefined,
);

function initialActiveProjectState(): ActiveProjectStateV2 {
  return (
    parseActiveProjectState(
      window.localStorage.getItem(ACTIVE_PROJECT_KEY),
    ) ?? {
      schemaVersion: 2,
      lastRouteByProject: {},
      contextByProject: {},
      updatedAt: new Date().toISOString(),
    }
  );
}

function initialCreationDraft(): CreationDraftV1 | undefined {
  const stored = window.localStorage.getItem(CREATION_DRAFT_KEY);
  const parsed = parseCreationDraft(stored);
  if (stored && !parsed) window.localStorage.removeItem(CREATION_DRAFT_KEY);
  return parsed;
}

function initialPendingIntent(): PendingNavigationIntentV1 | undefined {
  const stored = window.localStorage.getItem(PENDING_INTENT_KEY);
  const parsed = parsePendingNavigationIntent(stored);
  if (stored && !parsed) window.localStorage.removeItem(PENDING_INTENT_KEY);
  return parsed;
}

export function StudioSessionProvider(props: { children: ReactNode }) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (event.type.startsWith("workspace.project-"))
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }),
    [client, queryClient],
  );
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [activeState, setActiveState] = useState(initialActiveProjectState);
  const [creationDraft, setCreationDraft] = useState<
    CreationDraftV1 | undefined
  >(initialCreationDraft);
  const [pendingIntent, setPendingIntent] = useState<
    PendingNavigationIntentV1 | undefined
  >(initialPendingIntent);
  const [activeProjectNotice, setActiveProjectNotice] = useState<string>();
  const routeProjectId = projectIdFromLocation(location);
  const activeProjectId = resolveActiveProjectId({
    projects,
    routeProjectId,
    storedProjectId: activeState.projectId,
    preserveRouteIdentity: hasExactWorkspaceReference(location),
  });
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );

  useEffect(() => {
    if (!pendingIntent || projectsLoading) return;
    const expired =
      Date.now() - Date.parse(pendingIntent.createdAt) > PENDING_INTENT_MAX_AGE;
    const missingProject =
      Boolean(pendingIntent.projectId) &&
      !projects.some((project) => project.id === pendingIntent.projectId);
    if (!expired && !missingProject && safeLocalRoute(pendingIntent.returnTo))
      return;
    setPendingIntent(undefined);
    window.localStorage.removeItem(PENDING_INTENT_KEY);
  }, [pendingIntent, projects, projectsLoading]);

  useEffect(() => {
    if (!routeProjectId || !activeProjectId || projectsLoading) return;
    if (projects.some((project) => project.id === routeProjectId)) return;
    // A stale project list cannot change an explicitly requested object's
    // identity. Its own page must report missing/foreign ownership instead.
    if (hasExactWorkspaceReference(location)) return;
    if (location.pathname.startsWith("/projects/")) {
      navigate(`/projects/${encodeURIComponent(activeProjectId)}`, {
        replace: true,
      });
      return;
    }
    const search = new URLSearchParams(location.search);
    search.set("projectId", activeProjectId);
    ["adaptationId", "episodeId", "scriptId", "sceneId", "shotId"].forEach(
      (key) => search.delete(key),
    );
    navigate(`${location.pathname}?${search}`, { replace: true });
  }, [
    activeProjectId,
    location.pathname,
    location.search,
    navigate,
    projects,
    projectsLoading,
    routeProjectId,
  ]);

  useEffect(() => {
    if (!projects.length || !activeProjectId) return;
    const storedInvalid =
      Boolean(activeState.projectId) &&
      !projects.some((project) => project.id === activeState.projectId);
    if (storedInvalid && !routeProjectId)
      setActiveProjectNotice(
        "上次使用的项目已不可用，已切换到最近更新的项目。",
      );
    const routeInvalid =
      Boolean(routeProjectId) &&
      !projects.some((project) => project.id === routeProjectId);
    if (routeInvalid)
      setActiveProjectNotice(
        hasExactWorkspaceReference(location)
          ? "指定对象的项目暂未核验，保留原深链接；不会改读最近项目或候选。"
          : "链接中的项目已不可用，已切换到最近更新的有效项目。",
      );
    else if (routeProjectId) setActiveProjectNotice(undefined);
    if (activeState.projectId === activeProjectId && !routeProjectId) return;
    setActiveState((current) => ({
      ...current,
      projectId: activeProjectId,
      updatedAt: new Date().toISOString(),
    }));
  }, [
    activeProjectId,
    activeState.projectId,
    projects,
    routeProjectId,
    location.search,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      ACTIVE_PROJECT_KEY,
      JSON.stringify(activeState),
    );
  }, [activeState]);

  useEffect(() => {
    if (!routeProjectId || routeProjectId !== activeProjectId) return;
    const context = workspaceContextFromRoute(location);
    const route = context?.route;
    if (!context || !route || route === "/") return;
    setActiveState((current) =>
      current.lastRouteByProject[routeProjectId] === route &&
      current.contextByProject[routeProjectId]?.route === route
        ? current
        : {
            ...current,
            lastRouteByProject: {
              ...current.lastRouteByProject,
              [routeProjectId]: route,
            },
            contextByProject: {
              ...current.contextByProject,
              [routeProjectId]: rememberedWorkspaceContext(
                current.contextByProject[routeProjectId],
                context,
              ),
            },
            updatedAt: new Date().toISOString(),
          },
    );
  }, [activeProjectId, location.pathname, location.search, routeProjectId]);

  const value = useMemo<StudioSessionValue>(
    () => ({
      projects,
      projectsLoading,
      activeProjectId,
      activeProject,
      activeProjectNotice,
      selectProject(projectId) {
        if (!projects.some((project) => project.id === projectId)) return;
        setActiveProjectNotice(undefined);
        setActiveState((current) => ({
          ...current,
          projectId,
          updatedAt: new Date().toISOString(),
        }));
      },
      rememberProjectRoute(projectId, route) {
        const safe = safeLocalRoute(route);
        if (!safe) return;
        setActiveState((current) => ({
          ...current,
          projectId,
          lastRouteByProject: {
            ...current.lastRouteByProject,
            [projectId]: safe,
          },
          updatedAt: new Date().toISOString(),
        }));
      },
      lastProjectRoute(projectId) {
        return safeLocalRoute(activeState.lastRouteByProject[projectId]);
      },
      rememberProductionObjectContext(projectId, references) {
        const search = new URLSearchParams({ projectId });
        for (const key of productionContextKeys) {
          if (references[key]) search.set(key, references[key]!);
        }
        const context = workspaceContextFromRoute({
          pathname: "/adapt",
          search: `?${search}`,
        });
        if (!context) return;
        setActiveState((current) =>
          current.contextByProject[projectId]?.route === context.route
            ? current
            : {
                ...current,
                contextByProject: {
                  ...current.contextByProject,
                  [projectId]: context,
                },
                updatedAt: new Date().toISOString(),
              },
        );
      },
      projectContext(projectId) {
        return activeState.contextByProject[projectId];
      },
      creationDraft,
      saveCreationDraft(draft, preserveAttempt = false) {
        const next = {
          ...draft,
          ...(preserveAttempt
            ? {}
            : {
                attemptId: undefined,
                frozenProjectInput: undefined,
                sourceImportAttempt: undefined,
                createdProjectId: undefined,
                initializationSteps: [],
              }),
          updatedAt: new Date().toISOString(),
        } satisfies CreationDraftV1;
        window.localStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify(next));
        setCreationDraft(next);
      },
      clearCreationDraft() {
        setCreationDraft(undefined);
        window.localStorage.removeItem(CREATION_DRAFT_KEY);
      },
      pendingIntent,
      savePendingIntent(intent) {
        const next: PendingNavigationIntentV1 = {
          ...intent,
          schemaVersion: 1,
          returnTo: safeLocalRoute(intent.returnTo) ?? "/",
          createdAt: new Date().toISOString(),
        };
        setPendingIntent(next);
        window.localStorage.setItem(PENDING_INTENT_KEY, JSON.stringify(next));
      },
      clearPendingIntent() {
        setPendingIntent(undefined);
        window.localStorage.removeItem(PENDING_INTENT_KEY);
      },
    }),
    [
      activeProject,
      activeProjectId,
      activeProjectNotice,
      activeState.lastRouteByProject,
      activeState.contextByProject,
      creationDraft,
      pendingIntent,
      projects,
      projectsLoading,
    ],
  );
  return (
    <StudioSessionContext.Provider value={value}>
      {props.children}
    </StudioSessionContext.Provider>
  );
}

export function useStudioSession(): StudioSessionValue {
  const value = useContext(StudioSessionContext);
  if (!value) throw new Error("桌面会话状态尚未初始化");
  return value;
}

export function AiSettingsLink(props: {
  actionId: string;
  projectId?: string;
  chapterId?: string;
  input?: string;
  returnTo?: string;
  className?: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const session = useStudioSession();
  const projectId =
    props.projectId ??
    projectIdFromLocation({
      pathname: location.pathname,
      search: location.search,
    }) ??
    session.activeProjectId;
  return (
    <Link
      className={props.className}
      to="/settings?setup=ai"
      onClick={() =>
        session.savePendingIntent({
          kind: "ai-action",
          returnTo:
            safeLocalRoute(
              props.returnTo ?? `${location.pathname}${location.search}`,
            ) ?? "/",
          ...(projectId ? { projectId } : {}),
          ...(props.chapterId ? { chapterId: props.chapterId } : {}),
          actionId: props.actionId,
          ...(props.input ? { input: props.input } : {}),
        })
      }
    >
      {props.children}
    </Link>
  );
}
