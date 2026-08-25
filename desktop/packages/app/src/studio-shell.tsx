import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { StudioClient } from "@dramaip/client";
import type { UiContributionMetadata } from "@dramaip/contracts";
import { contributionsOfKind } from "@dramaip/ui-runtime";
import {
  ConfirmProvider,
  InlineNotice,
  LoadingState,
  ThemeProvider,
  type ResolvedTheme,
} from "@dramaip/ui-shared";
import { AppShell, type ShellNavigationItem } from "./app-shell";
import { resolveBuiltinContributionSet } from "./contribution-registry";
import {
  RuntimeConnectionProvider,
  useRuntimeConnection,
} from "./runtime-connection";
import { UiShowcase } from "./ui-showcase";

const DeclarativeExtensionUi = lazy(
  () => import("./features/extensions/DeclarativeExtensionUi"),
);
const LazyProjectHome = lazy(() =>
  import("./features/workspace").then((module) => ({
    default: module.ProjectHomeFeature,
  })),
);
const LazyProjectWorkspace = lazy(() =>
  import("./features/workspace").then((module) => ({
    default: module.ProjectWorkspaceFeature,
  })),
);
const LazyProjectToolPage = lazy(() =>
  import("./features/workspace").then((module) => ({
    default: module.ProjectToolFeature,
  })),
);
const LazySearchPage = lazy(() =>
  import("./features/workspace").then((module) => ({
    default: module.SearchFeature,
  })),
);
const LazyNovelWritingHome = lazy(() =>
  import("./features/writing").then((module) => ({
    default: module.NovelWritingFeature,
  })),
);
const LazyNovelQuickStart = lazy(() =>
  import("./features/writing").then((module) => ({
    default: module.NovelQuickStartFeature,
  })),
);
const LazyCreativeWorkspace = lazy(() =>
  import("./features/creative").then((module) => ({
    default: module.CreativeFeature,
  })),
);
const LazyAdaptationWorkspace = lazy(() =>
  import("./features/production").then((module) => ({
    default: module.ProductionFeature,
  })),
);
const LazyProductionWorkspace = lazy(() =>
  import("./features/media").then((module) => ({
    default: module.MediaFeature,
  })),
);
const LazyReviewDeliveryWorkspace = lazy(() =>
  import("./features/review-delivery").then((module) => ({
    default: module.ReviewDeliveryFeature,
  })),
);
const LazyFeedbackPage = lazy(() =>
  import("./features/insights").then((module) => ({
    default: module.InsightsFeature,
  })),
);
const LazyTaskPage = lazy(() =>
  import("./features/automation").then((module) => ({
    default: module.AutomationFeature,
  })),
);
const LazySettingsPage = lazy(() =>
  import("./features/settings").then((module) => ({
    default: module.SettingsFeature,
  })),
);
const LazyAgentSidePanel = lazy(() =>
  import("./features/agents").then((module) => ({
    default: module.AgentSidePanelFeature,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

function syncNativeWindowTheme(
  client: StudioClient,
  theme: ResolvedTheme,
): void {
  void client.host.setWindowTheme(theme).catch(() => {
    // Renderer theming remains authoritative without a native overlay.
  });
}

export function AppRoot() {
  return (
    <RuntimeConnectionProvider>
      <AppBootstrap />
    </RuntimeConnectionProvider>
  );
}

function AppBootstrap() {
  const { client, runtime, state, error } = useRuntimeConnection();
  if (state === "incompatible")
    return (
      <InlineNotice tone="danger" className="m-6">
        当前桌面端与 Runtime 协议不兼容，请升级到匹配版本。
      </InlineNotice>
    );
  if (error)
    return (
      <InlineNotice tone="danger" className="m-6">
        Runtime 连接失败：{error.message}
      </InlineNotice>
    );
  if (!client || !runtime)
    return (
      <LoadingState
        label={`正在连接 DramaIP 本地服务（${state}）…`}
        className="min-h-screen bg-canvas"
      />
    );
  return (
    <ThemeProvider
      onResolvedThemeChange={(theme) => syncNativeWindowTheme(client, theme)}
    >
      <ConfirmProvider>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <Suspense
              fallback={
                <LoadingState
                  label="正在加载工作区…"
                  className="min-h-screen bg-canvas"
                />
              }
            >
              <Studio uiContributions={runtime.uiContributions} />
            </Suspense>
          </HashRouter>
        </QueryClientProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}

function Studio(props: { uiContributions: readonly UiContributionMetadata[] }) {
  const contributionSet = useMemo(
    () => resolveBuiltinContributionSet(props.uiContributions),
    [props.uiContributions],
  );
  useEffect(() => {
    for (const diagnostic of contributionSet.diagnostics)
      console.warn(
        `Built-in UI contribution rejected: ${diagnostic.contributionId} (${diagnostic.code})`,
      );
  }, [contributionSet.diagnostics]);
  const routeIds = new Set(
    contributionsOfKind(contributionSet.enabled, "route").map(
      (contribution) => contribution.id,
    ),
  );
  const assistantEnabled = contributionSet.enabled.some(
    (contribution) => contribution.id === "agents.slot.assistant",
  );
  const navigation = contributionsOfKind(
    contributionSet.enabled,
    "navigation",
  ).flatMap((contribution): ShellNavigationItem[] => {
    const metadata = contribution.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      return [];
    const record = metadata as Readonly<Record<string, unknown>>;
    const { section, order, label, to } = record;
    return (section === "main" || section === "secondary") &&
      typeof order === "number" &&
      typeof label === "string" &&
      typeof to === "string"
      ? [{ id: contribution.id, section, order, label, to }]
      : [];
  });
  const routeEnabled = (id: string) => routeIds.has(id);
  return (
    <AppShell
      assistant={assistantEnabled ? <LazyAgentSidePanel /> : null}
      navigation={navigation}
    >
      <Routes>
        {routeEnabled("workspace.route.home") && (
          <Route path="/" element={<LazyProjectHome />} />
        )}
        {routeEnabled("workspace.route.project") && (
          <Route
            path="/projects/:projectId"
            element={<LazyProjectWorkspace />}
          />
        )}
        {routeEnabled("workspace.route.project-tools") && (
          <Route
            path="/projects/:projectId/tools/:toolKey?"
            element={<LazyProjectToolPage />}
          />
        )}
        {routeEnabled("writing.route.home") && (
          <Route path="/write" element={<LazyNovelWritingHome />} />
        )}
        {routeEnabled("writing.route.quick-start") && (
          <Route path="/write/new" element={<LazyNovelQuickStart />} />
        )}
        {routeEnabled("workspace.route.search") && (
          <Route path="/search" element={<LazySearchPage />} />
        )}
        {routeEnabled("creative-quality.route.workspace") && (
          <Route path="/create" element={<LazyCreativeWorkspace />} />
        )}
        {routeEnabled("production.route.workspace") && (
          <Route path="/adapt" element={<LazyAdaptationWorkspace />} />
        )}
        {routeEnabled("media.route.workspace") && (
          <Route path="/produce" element={<LazyProductionWorkspace />} />
        )}
        {routeEnabled("review.route.workspace") && (
          <Route path="/review" element={<LazyReviewDeliveryWorkspace />} />
        )}
        {routeEnabled("insights.route.dashboard") && (
          <Route path="/insights" element={<LazyFeedbackPage />} />
        )}
        {routeEnabled("automation.route.tasks") && (
          <Route path="/tasks" element={<LazyTaskPage />} />
        )}
        {routeEnabled("system.route.settings") && (
          <Route path="/settings" element={<LazySettingsPage />} />
        )}
        {import.meta.env.DEV ? (
          <Route path="/__ui" element={<UiShowcase />} />
        ) : null}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DeclarativeExtensionUi slot="workspace.panels" />
    </AppShell>
  );
}
