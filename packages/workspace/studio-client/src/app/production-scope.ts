import { useQuery } from "./query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "./router";
import { useStudioSession } from "./studio-session";
import { useStudio } from "./studio-shared";
import {
  productionReferenceKey,
  readProductionObjectContext,
  withExactProductionRecord,
  type ProductionObjectContext,
} from "./production-object-context";

/** A record a scope choice offers. */
export interface ScopeRecord {
  readonly id: string;
  readonly title: string;
}

/**
 * The project and production objects a route names, checked before a page
 * renders a body: every reference must resolve inside the named project.
 */
export interface ProductionScope {
  /** `checking` until the references are read; `failed` when one does not hold. */
  readonly status: "checking" | "failed" | "ready";
  /** The named project, else the active one; empty when there is none. */
  readonly projectId: string;
  /** The production objects the route names, once read. */
  readonly context: ProductionObjectContext;
  /** Changes whenever the route names other objects. */
  readonly key: string;
}

/** Read and check the project and production objects the route names. */
export function useProductionScope(): ProductionScope {
  const location = useLocation();
  const session = useStudioSession();
  const client = useStudio();
  const params = new URLSearchParams(location.search);
  const projectId = params.get("projectId") ?? session.activeProjectId ?? "";
  const projectReferences = params.getAll("projectId");
  const malformedProject =
    projectReferences.length > 1 ||
    (projectReferences.length === 1 && !projectReferences[0]?.trim());
  const key = JSON.stringify([
    projectReferences,
    productionReferenceKey(location.search),
  ]);
  const scope = useQuery({
    queryKey: ["production-route-context", projectId, key],
    enabled: Boolean(projectId) && !malformedProject,
    retry: false,
    queryFn: async () => {
      if (params.getAll("projectId").length > 1)
        throw new Error("指定项目引用重复。");
      const project = await client.projects.get(projectId);
      if (project.id !== projectId) throw new Error("指定项目身份不符。");
      return readProductionObjectContext({
        projectId,
        search: location.search,
        get: client.resources.get,
      });
    },
  });
  return {
    status:
      malformedProject || (projectId && scope.error)
        ? "failed"
        : projectId && !scope.data
          ? "checking"
          : "ready",
    projectId,
    context: scope.data ?? {},
    key: JSON.stringify([projectId, productionReferenceKey(location.search)]),
  };
}

/** The route values an episode-scoped page keeps in its address. */
export interface EpisodeRoute {
  readonly projectId?: string;
  readonly adaptationId?: string;
  readonly episodeId?: string;
  readonly stage?: string;
}

/** The project, adaptation and episode an episode-scoped page works on. */
export interface EpisodeScope {
  readonly projects: readonly (ScopeRecord & {
    readonly currentAdaptationId?: string | null;
  })[];
  readonly projectId: string;
  readonly adaptations: readonly ScopeRecord[];
  readonly adaptationId: string;
  readonly episodes: readonly ScopeRecord[];
  readonly episodeId: string;
  /** The stage the address asks for, if any. */
  readonly requestedStage: string | null;
  /** Choose a project; clears the adaptation and episode choice. */
  selectProject(projectId: string): void;
  /** Choose an adaptation; clears the episode choice. */
  selectAdaptation(adaptationId: string): void;
  selectEpisode(episodeId: string): void;
  /** Write the page's choice into its address. */
  sync(next: EpisodeRoute): void;
}

/**
 * The adaptation and episode choice of an episode-scoped page inside a
 * checked {@link ProductionScope}. The address's references win; otherwise
 * the project's current adaptation and the first episode are chosen.
 * @param path - the page's route, which `sync` writes.
 */
export function useEpisodeScope(
  path: string,
  scope: Pick<ProductionScope, "projectId" | "context">,
): EpisodeScope {
  const client = useStudio();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useStudioSession();
  const { projectId, context } = scope;
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [selectedAdaptationId, setAdaptationId] = useState("");
  const [selectedEpisodeId, setEpisodeId] = useState("");
  const adaptationId = context.adaptationId?.id ?? selectedAdaptationId;
  const episodeId = context.episodeId?.id ?? selectedEpisodeId;
  const { data: listedAdaptations = [] } = useQuery({
    queryKey: ["resource", "adaptations", projectId],
    queryFn: () => client.resources.list("adaptations", projectId),
    enabled: Boolean(projectId),
  });
  const { data: listedEpisodes = [] } = useQuery({
    queryKey: ["resource", "episodes", projectId, adaptationId],
    queryFn: () => client.resources.list("episodes", projectId, adaptationId),
    enabled: Boolean(projectId && adaptationId),
  });
  const adaptations = withExactProductionRecord(
    listedAdaptations,
    context.adaptationId,
  );
  const episodes = withExactProductionRecord(listedEpisodes, context.episodeId);
  useEffect(() => {
    if (adaptationId && !adaptations.some((item) => item.id === adaptationId))
      setAdaptationId("");
  }, [adaptationId, adaptations]);
  useEffect(() => {
    if (adaptationId || !adaptations.length) return;
    const current = projects.find(
      (project) => project.id === projectId,
    )?.currentAdaptationId;
    setAdaptationId(
      adaptations.some((item) => item.id === current)
        ? current!
        : adaptations[0]!.id,
    );
  }, [adaptationId, adaptations, projectId, projects]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("adaptationId");
    if (requested && adaptations.some((item) => item.id === requested))
      setAdaptationId(requested);
  }, [adaptations, location.search]);
  useEffect(() => {
    if (episodeId && !episodes.some((item) => item.id === episodeId))
      setEpisodeId("");
  }, [episodeId, episodes]);
  useEffect(() => {
    if (!episodeId && episodes[0]) setEpisodeId(episodes[0].id);
  }, [episodeId, episodes]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("episodeId");
    if (requested && episodes.some((item) => item.id === requested))
      setEpisodeId(requested);
  }, [episodes, location.search]);
  const requestedStage = new URLSearchParams(location.search).get("stage");
  const sync = (next: EpisodeRoute) => {
    const search = new URLSearchParams();
    const values = {
      projectId,
      stage: requestedStage ?? undefined,
      adaptationId,
      episodeId,
      ...next,
    };
    if (
      (!next.projectId || next.projectId === projectId) &&
      (!next.episodeId || next.episodeId === episodeId) &&
      next.episodeId !== ""
    ) {
      const original = new URLSearchParams(location.search);
      for (const key of ["scriptId", "sceneId", "shotId"]) {
        const value = original.get(key);
        if (value) search.set(key, value);
      }
    }
    Object.entries(values).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    navigate(`${path}?${search}`);
  };
  return {
    projects,
    projectId,
    adaptations,
    adaptationId,
    episodes,
    episodeId,
    requestedStage,
    selectProject: (next) => {
      if (next) session.selectProject(next);
      setAdaptationId("");
      setEpisodeId("");
      sync({ projectId: next, adaptationId: "", episodeId: "" });
    },
    selectAdaptation: (next) => {
      setAdaptationId(next);
      setEpisodeId("");
      sync({ adaptationId: next, episodeId: "" });
    },
    selectEpisode: (next) => {
      setEpisodeId(next);
      sync({ episodeId: next });
    },
    sync,
  };
}
