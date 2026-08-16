import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Check,
  ChevronDown,
  Ellipsis,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  X,
} from "lucide-react";

import { StudioClient } from "@dramaip/client";
import {
  bootRendererKernel,
  type RunningRendererKernel,
} from "@dramaip/kernel/renderer";
import type {
  UiNavigationContribution,
  UiRouteContribution,
  UiSlotContribution,
} from "@dramaip/plugin-api";
import {
  Button,
  ConfirmProvider,
  Drawer,
  DropdownMenu,
  IconButton,
  ThemeProvider,
  useTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@dramaip/ui";
import { createRendererCatalog, rendererProfile } from "@dramaip/ui-catalog";
import {
  StudioClientProvider,
  UiSlotProvider,
  type ResolvedUiSlot,
} from "@dramaip/ui-shared";

class ApplicationErrorBoundary extends Component<
  PropsWithChildren,
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Renderer plugin failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="startup-screen">
          <div className="startup-card">
            <p className="eyebrow">PLUGIN FAILURE</p>
            <h1>插件页面加载失败</h1>
            <p>{this.state.error.message}</p>
            <Button variant="primary" onClick={() => location.reload()}>
              重新加载
            </Button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

interface ResolvedRoute {
  route: UiRouteContribution;
  Page: ComponentType;
}

function PluginRoutes({ pages }: { pages: readonly ResolvedRoute[] }) {
  return (
    <Routes>
      {pages.map(({ route, Page }) => (
        <Route key={route.id} path={route.path} element={<Page />} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

function ThemeMenu() {
  const { mode, resolvedTheme, setMode } = useTheme();
  const ActiveThemeIcon = resolvedTheme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <IconButton aria-label="切换外观主题" variant="ghost" size="sm">
          <ActiveThemeIcon aria-hidden="true" className="size-[18px]" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" aria-label="外观主题">
        <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-medium text-muted">
          外观主题
        </DropdownMenu.Label>
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => setMode(option.value)}
            >
              <Icon aria-hidden="true" className="size-4 text-muted" />
              <span className="flex-1">{option.label}</span>
              {mode === option.value ? (
                <Check
                  aria-hidden="true"
                  className="size-4 text-brand-strong"
                />
              ) : null}
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

function resolveNavigationPath(
  item: UiNavigationContribution,
  projectId?: string,
): string {
  return item.to.replace(":projectId", projectId ?? "");
}

function routeActive(
  pathname: string,
  search: string,
  item: UiNavigationContribution,
  target: string,
): boolean {
  const current = `${pathname}${search}`;
  if (target.includes("?")) return current === target;
  if (target === "/") return pathname === "/";
  const patterns = item.activePaths ?? [target];
  return patterns.some((source) => {
    const pattern = source.replace(":projectId", "[^/]+").replaceAll("*", ".*");
    return new RegExp(`^${pattern}(?:/|$)`).test(pathname);
  });
}

function NavigationLink({
  item,
  projectId,
  project = false,
}: {
  item: UiNavigationContribution;
  projectId?: string;
  project?: boolean;
}) {
  const location = useLocation();
  const target = resolveNavigationPath(item, projectId);
  const active = routeActive(location.pathname, location.search, item, target);
  return (
    <Link
      to={target}
      aria-current={active ? "page" : undefined}
      className={
        project
          ? `project-navigation-link ${active ? "active" : ""}`
          : `relative shrink-0 rounded-md px-3 py-2 text-[15px] font-medium leading-none outline-none transition focus-visible:ring-2 focus-visible:ring-focus ${
              active
                ? "bg-brand-soft text-brand-strong"
                : "text-muted hover:bg-surface-muted hover:text-ink"
            }`
      }
    >
      {item.label}
      {!project && active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-brand"
        />
      ) : null}
    </Link>
  );
}

function StudioShell({
  pages,
  navigation,
  slots,
}: {
  pages: readonly ResolvedRoute[];
  navigation: readonly UiNavigationContribution[];
  slots: readonly ResolvedUiSlot[];
}) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const location = useLocation();
  const projectId = /^\/projects\/([0-9a-f-]{36})(?:\/|$)/i.exec(
    location.pathname,
  )?.[1];
  const projectTools = /^\/projects\/[0-9a-f-]{36}\/tools(?:\/|$)/i.test(
    location.pathname,
  );
  const mainNavigation = navigation.filter((item) => item.section === "main");
  const secondaryNavigation = navigation.filter(
    (item) => item.section === "settings",
  );
  const projectNavigation = navigation.filter(
    (item) => item.section === "project",
  );
  const assistant = slots.filter((slot) => slot.slot === "shell.assistant");
  const projectHeaderLeading = slots.filter(
    (slot) => slot.slot === "project.header.leading",
  );
  const projectHeaderActions = slots.filter(
    (slot) => slot.slot === "project.header.actions",
  );
  const moreActive = secondaryNavigation.some((item) =>
    routeActive(
      location.pathname,
      location.search,
      item,
      resolveNavigationPath(item, projectId),
    ),
  );

  useEffect(() => {
    const open = () => setAssistantOpen(true);
    window.addEventListener("dramaip:open-assistant", open);
    return () => window.removeEventListener("dramaip:open-assistant", open);
  }, []);

  return (
    <div className="workbench min-h-screen bg-canvas">
      <header className="app-drag-region sticky top-0 z-50 h-16 border-b border-line/80 bg-canvas/92 backdrop-blur-xl">
        <div className="app-titlebar-content flex h-full w-full items-center gap-3 px-5">
          <Link
            to="/"
            aria-label="DramaIP 项目首页"
            className="no-drag mr-2 flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-action text-sm font-semibold text-action-contrast shadow-control"
            >
              D
            </span>
            <span>DramaIP</span>
          </Link>

          <nav
            className={`no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 studio-scrollbar ${projectId ? "justify-end" : "justify-start"}`}
            aria-label="主导航"
          >
            {mainNavigation.map((item) => (
              <NavigationLink key={item.id} item={item} projectId={projectId} />
            ))}
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant={moreActive ? "subtle" : "ghost"}
                  size="sm"
                  aria-current={moreActive ? "page" : undefined}
                >
                  <Ellipsis aria-hidden="true" className="size-4" />
                  更多
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" aria-label="更多页面">
                {secondaryNavigation.map((item) => {
                  const target = resolveNavigationPath(item, projectId);
                  const active = routeActive(
                    location.pathname,
                    location.search,
                    item,
                    target,
                  );
                  return (
                    <DropdownMenu.Item key={item.id} asChild>
                      <Link
                        to={target}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="flex-1">{item.label}</span>
                        {active ? (
                          <Check
                            aria-hidden="true"
                            className="size-4 text-brand-strong"
                          />
                        ) : null}
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu>
          </nav>

          <div className="no-drag ml-auto flex shrink-0 items-center gap-1.5">
            <ThemeMenu />
            <Button
              variant="primary"
              size="sm"
              aria-label="打开智能助手"
              onClick={() => setAssistantOpen(true)}
            >
              <Sparkles aria-hidden="true" className="size-4" />
              <span className="hidden xl:inline">智能助手</span>
            </Button>
          </div>
        </div>
      </header>

      {projectId && projectNavigation.length && !projectTools ? (
        <section className="project-context-header">
          <div className="project-context-row">
            <div className="project-context-leading">
              {projectHeaderLeading.map(({ id, Component }) => (
                <Component key={id} />
              ))}
            </div>
            <div className="project-context-actions">
              {projectHeaderActions.map(({ id, Component }) => (
                <Component key={id} />
              ))}
            </div>
          </div>
          <nav className="project-navigation" aria-label="项目导航">
            <div className="project-navigation-inner studio-scrollbar">
              {projectNavigation.map((item) => (
                <NavigationLink
                  key={item.id}
                  item={item}
                  projectId={projectId}
                  project
                />
              ))}
            </div>
          </nav>
        </section>
      ) : null}

      <main className={projectId ? "w-full" : "mx-auto w-full max-w-[1440px]"}>
        <ApplicationErrorBoundary>
          <Suspense
            fallback={<div className="empty-state">正在装载插件页面…</div>}
          >
            <PluginRoutes pages={pages} />
          </Suspense>
        </ApplicationErrorBoundary>
      </main>

      <Drawer open={assistantOpen} onOpenChange={setAssistantOpen}>
        <Drawer.Content
          aria-label="DramaIP 智能助手"
          className="w-[min(560px,calc(100vw-1rem))] p-0"
          hideClose
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-raised/95 px-5 py-4 backdrop-blur-xl">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-brand-strong">
                DRAMAIP · 智能协作
              </p>
              <Drawer.Title className="mt-1">DramaIP 智能助手</Drawer.Title>
            </div>
            <Drawer.Close asChild>
              <IconButton aria-label="关闭智能助手" variant="ghost" size="sm">
                <X aria-hidden="true" className="size-4" />
              </IconButton>
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {assistant.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
        </Drawer.Content>
      </Drawer>
    </div>
  );
}

function NativeThemeProvider({ children }: { children: ReactNode }) {
  const syncNativeTheme = useCallback((theme: ResolvedTheme) => {
    void window.dramaip.window.setTheme(theme);
  }, []);
  return (
    <ThemeProvider onResolvedThemeChange={syncNativeTheme}>
      {children}
    </ThemeProvider>
  );
}

export function StudioApplication() {
  const [state, setState] = useState<{
    client: StudioClient;
    kernel: RunningRendererKernel;
    pages: readonly ResolvedRoute[];
    navigation: readonly UiNavigationContribution[];
    slots: readonly ResolvedUiSlot[];
  }>();
  const [error, setError] = useState<Error>();
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    let kernel: RunningRendererKernel | undefined;
    void (async () => {
      const init = await window.dramaip.init();
      const client = new StudioClient({
        baseUrl: init.apiBaseUrl,
        username: init.username,
        password: init.password,
      });
      const catalog = createRendererCatalog();
      kernel = await bootRendererKernel(
        rendererProfile,
        catalog.descriptors,
        catalog.modules,
      );
      if (active) {
        const pages = await Promise.all(
          kernel.context.uiRegistry.routes().map(async (route) => {
            const module = await route.component();
            return { route, Page: module.default as ComponentType };
          }),
        );
        const slots = await Promise.all(
          (
            [
              "shell.assistant",
              "project.section",
              "project.header.leading",
              "project.header.actions",
              "chapter.auxiliary",
              "settings.section",
            ] as const
          ).flatMap((slot) =>
            kernel!.context.uiRegistry
              .slots(slot)
              .map(async (contribution: UiSlotContribution) => {
                const module = await contribution.component();
                return {
                  id: contribution.id,
                  slot: contribution.slot,
                  Component: module.default as ComponentType,
                };
              }),
          ),
        );
        setState({
          client,
          kernel,
          pages,
          navigation: kernel.context.uiRegistry.navigation(),
          slots,
        });
      } else {
        await kernel.dispose();
      }
    })().catch((reason) =>
      setError(reason instanceof Error ? reason : new Error(String(reason))),
    );
    return () => {
      active = false;
      void kernel?.dispose();
    };
  }, []);

  let content: ReactNode;
  if (error) {
    content = (
      <main className="startup-screen">
        <div className="startup-card">
          <p className="eyebrow">STARTUP FAILED</p>
          <h1>DramaIP Studio 无法启动</h1>
          <p>{error.message}</p>
        </div>
      </main>
    );
  } else if (!state) {
    content = (
      <main className="startup-screen">
        <div className="startup-card">
          <div className="loading-orbit" />
          <p className="eyebrow">CORDIS KERNEL</p>
          <h1>正在装配创作插件</h1>
          <p>启动本地数据库、领域服务和 UI Fiber…</p>
        </div>
      </main>
    );
  } else {
    content = (
      <QueryClientProvider client={queryClient}>
        <StudioClientProvider client={state.client}>
          <UiSlotProvider slots={state.slots}>
            <BrowserRouter>
              <StudioShell
                pages={state.pages}
                navigation={state.navigation}
                slots={state.slots}
              />
            </BrowserRouter>
          </UiSlotProvider>
        </StudioClientProvider>
      </QueryClientProvider>
    );
  }
  return (
    <NativeThemeProvider>
      <ConfirmProvider>{content}</ConfirmProvider>
    </NativeThemeProvider>
  );
}
