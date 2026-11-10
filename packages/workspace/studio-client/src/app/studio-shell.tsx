import { QueryClient, QueryClientProvider } from "./query";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { HashRouter, Navigate, Route, Routes } from "./router";
import type { StudioClient } from "../facade/index";
import type { UiContributionMetadata } from "@dramaip/contracts";
import { contributionsOfKind } from "../contributions/index";
import {
  ConfirmProvider,
  ControlLabelsProvider,
  Button,
  InlineNotice,
  LoadingState,
  ToastProvider,
} from "@dramaip/infra-ui-primitives";
import { controlLabels } from "./controls";
import { useTheme } from "./theme-mode";
import { AppShell, type ShellNavigationItem } from "./app-shell";
import { resolveBuiltinContributionSet } from "./contribution-registry";
import {
  RuntimeConnectionProvider,
  useRuntimeConnection,
} from "./runtime-connection";
import { UiShowcase } from "./ui-showcase";
import {
  PluginRoute,
  PluginRouteProvider,
  type PluginRouteRenderer,
} from "./plugin-routes";
import { StudioSessionProvider } from "./studio-session";
import styles from "./studio-shell.module.css";
import { copyText } from "./copy";

const LazyProjectHome = lazy(() =>
  import("./features/workspace").then((module) => ({
    default: module.ProjectHomeFeature,
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

/** Keep the native window overlay on the renderer's resolved scheme. */
function useNativeWindowTheme(client: StudioClient | undefined): void {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!client) return;
    void client.host.setWindowTheme(resolvedTheme).catch(() => {
      // Renderer theming remains authoritative without a native overlay.
    });
  }, [client, resolvedTheme]);
}

export function AppRoot(props: { pluginRoutes?: PluginRouteRenderer }) {
  return (
    <ControlLabelsProvider labels={controlLabels()}>
      <PluginRouteProvider render={props.pluginRoutes}>
        <RuntimeConnectionProvider>
          <AppBootstrap />
        </RuntimeConnectionProvider>
      </PluginRouteProvider>
    </ControlLabelsProvider>
  );
}

function AppBootstrap() {
  const { client, runtime, state, error, reconnect } = useRuntimeConnection();
  useNativeWindowTheme(client);
  if (state === "incompatible")
    return (
      <InlineNotice tone="danger" className={styles.c1}>
        {copyText("app/studio-shell.1")}
      </InlineNotice>
    );
  if (error)
    return (
      <main className={styles.c2}>
        <div className={styles.c3}>
          <InlineNotice tone="danger">
            {copyText("app/studio-shell.2")}
          </InlineNotice>
          <p className={styles.c4}>{error.message}</p>
          <div className={styles.c5}>
            <Button variant="primary" onClick={reconnect}>
              {copyText("app/studio-shell.3")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {copyText("app/studio-shell.4")}
            </Button>
          </div>
        </div>
      </main>
    );
  if (!client || !runtime)
    return (
      <LoadingState
        label={`正在连接尽意本地服务（${state}）…`}
        className={styles.c6}
      />
    );
  return (
    <ConfirmProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <StudioSessionProvider>
              <Suspense
                fallback={
                  <LoadingState label="正在加载工作区…" className={styles.c6} />
                }
              >
                <Studio uiContributions={runtime.uiContributions} />
              </Suspense>
            </StudioSessionProvider>
          </HashRouter>
        </QueryClientProvider>
      </ToastProvider>
    </ConfirmProvider>
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
            element={<PluginRoute path="/projects/:projectId" />}
          />
        )}
        {routeEnabled("workspace.route.project-tools") && (
          <Route
            path="/projects/:projectId/tools/:toolKey?"
            element={
              <PluginRoute path="/projects/:projectId/tools/:toolKey?" />
            }
          />
        )}
        {routeEnabled("writing.route.home") && (
          <Route path="/write" element={<PluginRoute path="/write" />} />
        )}
        {routeEnabled("writing.route.quick-start") && (
          <Route
            path="/write/new"
            element={<PluginRoute path="/write/new" />}
          />
        )}
        {routeEnabled("workspace.route.search") && (
          <Route path="/search" element={<PluginRoute path="/search" />} />
        )}
        {routeEnabled("creative-quality.route.workspace") && (
          <Route path="/create" element={<PluginRoute path="/create" />} />
        )}
        {routeEnabled("production.route.workspace") && (
          <Route path="/adapt" element={<PluginRoute path="/adapt" />} />
        )}
        {routeEnabled("media.route.workspace") && (
          <Route path="/produce" element={<PluginRoute path="/produce" />} />
        )}
        {routeEnabled("review.route.workspace") && (
          <Route
            path="/review"
            element={<PluginRoute path="/review" workbench />}
          />
        )}
        {routeEnabled("insights.route.dashboard") && (
          <Route path="/insights" element={<PluginRoute path="/insights" />} />
        )}
        {routeEnabled("automation.route.tasks") && (
          <Route path="/tasks" element={<PluginRoute path="/tasks" />} />
        )}
        {routeEnabled("automation.route.pending") && (
          <Route path="/pending" element={<PluginRoute path="/pending" />} />
        )}
        {routeEnabled("agents.route.inspiration") && (
          <Route
            path="/inspiration"
            element={<PluginRoute path="/inspiration" />}
          />
        )}
        {routeEnabled("system.route.settings") && (
          <Route path="/settings" element={<PluginRoute path="/settings" />} />
        )}
        {import.meta.env.DEV ? (
          <Route path="/__ui" element={<UiShowcase />} />
        ) : null}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
