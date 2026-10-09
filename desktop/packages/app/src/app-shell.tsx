import {
  BareButton,
  Button,
  Drawer,
  DropdownMenu,
  IconButton,
  useTheme,
  type ThemeMode,
} from "@dramaip/ui-shared";
import {
  BadgeCheck,
  BarChart3,
  BookOpenText,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  FolderKanban,
  LayoutDashboard,
  LibraryBig,
  Lightbulb,
  ListTodo,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Search,
  Settings,
  Sparkles,
  Sun,
  WandSparkles,
  X,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { contextualNavigationTarget, useStudioSession } from "./studio-session";

export interface ShellNavigationItem {
  id: string;
  section: "main" | "secondary";
  order: number;
  label: string;
  to: string;
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

const SHELL_LAYOUT_KEY = "dramaip-shell-layout:v1";
const NAV_ICON: Record<string, LucideIcon> = {
  "/": LibraryBig,
  "/inspiration": Lightbulb,
  "/write": BookOpenText,
  "/create": WandSparkles,
  "/adapt": Clapperboard,
  "/produce": Film,
  "/review": BadgeCheck,
  "/insights": BarChart3,
  "/search": Search,
  "/tasks": ListTodo,
  "/pending": BadgeCheck,
  "/settings": Settings,
};
const PROJECT_ROUTES = new Set([
  "/write",
  "/create",
  "/adapt",
  "/produce",
  "/review",
  "/insights",
]);
const GLOBAL_ROUTES = new Set([
  "/",
  "/inspiration",
  "/search",
  "/tasks",
  "/pending",
  "/settings",
]);

function storedLayout(): {
  navigationCollapsed: boolean;
  assistantOpen: boolean;
} {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(SHELL_LAYOUT_KEY) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object")
      return { navigationCollapsed: false, assistantOpen: false };
    const record = value as Record<string, unknown>;
    return {
      navigationCollapsed: record.navigationCollapsed === true,
      assistantOpen: record.assistantOpen === true,
    };
  } catch {
    return { navigationCollapsed: false, assistantOpen: false };
  }
}

function routeActive(pathname: string, target: string): boolean {
  if (target === "/") return pathname === "/";
  if (target === "/write")
    return (
      pathname.startsWith("/write") ||
      (pathname.startsWith("/projects/") && !pathname.includes("/tools/"))
    );
  return pathname.startsWith(target);
}

function appBarProjectModeLabel(mode: string): string {
  return (
    {
      series_longform: "系列长篇",
      single_season: "单季短剧",
      personal_theater: "AI 小剧场",
      creator_channel: "博主内容工作室",
    }[mode] ?? "创作项目"
  );
}

function workAreaLabel(pathname: string): string {
  if (pathname.startsWith("/projects/") || pathname.startsWith("/write"))
    return "故事";
  if (pathname.startsWith("/adapt")) return "改编";
  if (pathname.startsWith("/produce")) return "制作";
  if (pathname.startsWith("/review")) return "审核交付";
  if (pathname.startsWith("/create")) return "创作工具";
  if (pathname.startsWith("/insights")) return "创作分析";
  if (pathname.startsWith("/tasks")) return "任务";
  if (pathname.startsWith("/pending")) return "待确认";
  if (pathname.startsWith("/inspiration")) return "灵感";
  if (pathname.startsWith("/search")) return "搜索";
  if (pathname.startsWith("/settings")) return "设置";
  return "项目库";
}

function objectTrail(search: string): Array<{ key: string; label: string }> {
  const params = new URLSearchParams(search);
  return [
    ["chapterId", "章节"],
    ["adaptationId", "改编方案"],
    ["episodeId", "分集"],
    ["scriptId", "剧本"],
    ["sceneId", "场景"],
    ["shotId", "镜头"],
  ].flatMap(([key, label]) => (params.get(key) ? [{ key, label }] : []));
}

export function ThemeMenu(props: { compact?: boolean }) {
  const { mode, resolvedTheme, setMode } = useTheme();
  const ActiveThemeIcon = resolvedTheme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        {props.compact ? (
          <IconButton aria-label="切换外观主题" variant="ghost" size="sm">
            <ActiveThemeIcon aria-hidden="true" className="size-[18px]" />
          </IconButton>
        ) : (
          <Button variant="ghost" size="sm">
            <ActiveThemeIcon aria-hidden="true" className="size-4" />
            外观
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Button>
        )}
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

export function ThemeSettings() {
  const { mode, setMode } = useTheme();
  return (
    <div
      className="grid gap-3 sm:grid-cols-3"
      role="radiogroup"
      aria-label="外观主题"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <BareButton
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`no-drag flex min-h-20 items-center gap-3 rounded-lg border px-4 text-left transition focus-visible:ring-2 focus-visible:ring-focus ${active ? "border-brand bg-brand-soft text-brand-strong shadow-control" : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-raised"}`}
            onClick={() => setMode(option.value)}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-md ${active ? "bg-surface/70" : "bg-surface-muted"}`}
            >
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <span>
              <span className="block text-sm font-semibold">
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {option.value === "system"
                  ? "随系统自动切换"
                  : option.value === "light"
                    ? "适合明亮环境"
                    : "适合低光环境"}
              </span>
            </span>
          </BareButton>
        );
      })}
    </div>
  );
}

function NavigationLink(props: {
  item: ShellNavigationItem;
  to: string;
  active: boolean;
  collapsed: boolean;
  label?: string;
}) {
  const Icon = NAV_ICON[props.item.to] ?? LayoutDashboard;
  return (
    <Link
      to={props.to}
      title={props.collapsed ? (props.label ?? props.item.label) : undefined}
      aria-current={props.active ? "page" : undefined}
      className={`studio-shell-nav-link ${props.active ? "studio-shell-nav-link-active" : ""}`}
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0" />
      <span className="studio-shell-nav-label truncate">
        {props.label ?? props.item.label}
      </span>
    </Link>
  );
}

export function AppShell(props: {
  children: ReactNode;
  assistant: ReactNode;
  navigation: readonly ShellNavigationItem[];
}) {
  const initialLayout = useMemo(storedLayout, []);
  const isMacOS = /Macintosh|Mac OS X/.test(window.navigator.userAgent);
  const [assistantOpen, setAssistantOpen] = useState(
    initialLayout.assistantOpen,
  );
  const [navigationCollapsed, setNavigationCollapsed] = useState(
    initialLayout.navigationCollapsed,
  );
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [wideAssistant, setWideAssistant] = useState(
    () => window.matchMedia("(min-width: 1280px)").matches,
  );
  const location = useLocation();
  const navigate = useNavigate();
  const {
    projects,
    activeProject,
    activeProjectId,
    activeProjectNotice,
    selectProject,
    lastProjectRoute,
    projectContext,
  } = useStudioSession();
  const sortedNavigation = [...props.navigation].sort(
    (left, right) => left.order - right.order,
  );
  const globalNavigation = sortedNavigation.filter((item) =>
    GLOBAL_ROUTES.has(item.to),
  );
  const projectNavigation = sortedNavigation.filter((item) =>
    PROJECT_ROUTES.has(item.to),
  );
  const projectOverview = sortedNavigation.find((item) => item.to === "/");
  const trail = objectTrail(location.search);

  useEffect(() => {
    window.localStorage.setItem(
      SHELL_LAYOUT_KEY,
      JSON.stringify({ navigationCollapsed, assistantOpen }),
    );
  }, [assistantOpen, navigationCollapsed]);

  useEffect(() => {
    const open = () => setAssistantOpen(true);
    window.addEventListener("dramaip:open-assistant-conversation", open);
    return () =>
      window.removeEventListener("dramaip:open-assistant-conversation", open);
  }, []);

  useEffect(
    () => setMobileNavigationOpen(false),
    [location.pathname, location.search],
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setWideAssistant(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const switchProject = (projectId: string): void => {
    selectProject(projectId);
    const remembered = lastProjectRoute(projectId);
    navigate(
      remembered ?? `/projects/${encodeURIComponent(projectId)}/tools/cockpit`,
    );
  };

  const openAssistant = (): void => {
    const event = new CustomEvent("dramaip:open-novel-assistant", {
      cancelable: true,
    });
    if (window.dispatchEvent(event)) setAssistantOpen(true);
  };

  const sidebar = (
    <>
      <div
        className={`app-drag-region studio-shell-brand ${isMacOS ? "studio-shell-brand-macos" : ""}`}
      >
        <Link
          to="/"
          aria-label="尽意项目首页"
          className="no-drag studio-shell-brand-link flex min-w-0 items-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="studio-shell-brand-mark grid size-8 shrink-0 place-items-center rounded-md bg-action text-sm font-semibold text-action-contrast"
          >
            意
          </span>
          <span className="studio-shell-nav-label truncate text-sm font-semibold">
            尽意 DramaIP
          </span>
        </Link>
        {!isMacOS ? (
          <IconButton
            className="no-drag studio-shell-desktop-navigation-trigger"
            aria-label={navigationCollapsed ? "展开导航" : "收起导航"}
            variant="ghost"
            size="sm"
            onClick={() => setNavigationCollapsed((value) => !value)}
          >
            {navigationCollapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </IconButton>
        ) : null}
      </div>
      <div className="studio-shell-navigation studio-scrollbar">
        <nav aria-label="全局导航" className="space-y-1">
          <p className="studio-shell-nav-section">全局</p>
          {globalNavigation.map((item) => (
            <NavigationLink
              key={`global-${item.id}`}
              item={item}
              to={item.to}
              active={routeActive(location.pathname, item.to)}
              collapsed={navigationCollapsed}
              label={item.to === "/" ? "项目库" : undefined}
            />
          ))}
        </nav>
        {activeProject && projectOverview ? (
          <nav aria-label="当前项目导航" className="mt-6 space-y-1">
            <p className="studio-shell-nav-section">当前项目</p>
            <NavigationLink
              item={projectOverview}
              to={`/projects/${encodeURIComponent(activeProject.id)}/tools/cockpit`}
              active={
                location.pathname ===
                `/projects/${activeProject.id}/tools/cockpit`
              }
              collapsed={navigationCollapsed}
              label="概览"
            />
            {projectNavigation.map((item) => (
              <NavigationLink
                key={`project-${item.id}`}
                item={item}
                to={contextualNavigationTarget(
                  item.to,
                  activeProjectId,
                  activeProjectId ? projectContext(activeProjectId) : undefined,
                )}
                active={routeActive(location.pathname, item.to)}
                collapsed={navigationCollapsed}
              />
            ))}
          </nav>
        ) : null}
      </div>
      <div className="border-t border-line p-2">
        <Button
          variant="subtle"
          size="sm"
          className="w-full justify-start"
          onClick={openAssistant}
          aria-label="打开 AI 办事助手"
        >
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          <span className="studio-shell-nav-label">智能助手</span>
        </Button>
      </div>
    </>
  );

  return (
    <div
      className={`studio-shell ${isMacOS ? "studio-shell-macos" : ""} ${navigationCollapsed ? "studio-shell-navigation-collapsed" : ""} ${assistantOpen && props.assistant ? "studio-shell-assistant-open" : ""}`}
    >
      <aside className="studio-shell-sidebar">{sidebar}</aside>

      <header className="app-drag-region studio-shell-contextbar">
        <div className="app-titlebar-content flex h-full min-w-0 items-center gap-2 px-3">
          <IconButton
            className="no-drag studio-shell-mobile-navigation-trigger"
            aria-label="打开导航"
            variant="ghost"
            size="sm"
            onClick={() => setMobileNavigationOpen(true)}
          >
            <Menu aria-hidden="true" className="size-4" />
          </IconButton>
          {isMacOS ? (
            <IconButton
              className="no-drag studio-shell-desktop-navigation-trigger"
              aria-label={navigationCollapsed ? "展开导航" : "收起导航"}
              variant="ghost"
              size="sm"
              onClick={() => setNavigationCollapsed((value) => !value)}
            >
              {navigationCollapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="size-4" />
              )}
            </IconButton>
          ) : null}
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="no-drag min-w-0 max-w-64"
                aria-label={
                  activeProject
                    ? `当前项目：${activeProject.title}`
                    : "当前没有项目"
                }
              >
                <FolderKanban aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">
                  {activeProject?.title ?? "选择项目"}
                </span>
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" aria-label="切换当前项目">
              {projects.map((project) => (
                <DropdownMenu.Item
                  key={project.id}
                  onSelect={() => switchProject(project.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{project.title}</span>
                    <span className="block text-xs text-muted">
                      {appBarProjectModeLabel(project.mode)}
                    </span>
                  </span>
                  {project.id === activeProjectId ? (
                    <Check
                      aria-hidden="true"
                      className="size-4 text-brand-strong"
                    />
                  ) : null}
                </DropdownMenu.Item>
              ))}
              {!projects.length ? (
                <DropdownMenu.Item disabled>尚未创建项目</DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu>
          <span aria-hidden="true" className="text-line-strong">
            /
          </span>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" className="no-drag min-w-0">
                <span className="truncate">
                  {workAreaLabel(location.pathname)}
                </span>
                {trail.length ? (
                  <span className="hidden text-xs text-muted md:inline">
                    / {trail.at(-1)?.label}
                  </span>
                ) : null}
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" aria-label="切换工作区">
              {projectNavigation.map((item) => (
                <DropdownMenu.Item key={`context-${item.id}`} asChild>
                  <Link
                    to={contextualNavigationTarget(
                      item.to,
                      activeProjectId,
                      activeProjectId
                        ? projectContext(activeProjectId)
                        : undefined,
                    )}
                  >
                    {item.label}
                  </Link>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu>
          <div className="no-drag ml-auto flex shrink-0 items-center gap-1">
            <IconButton
              asChild
              aria-label="搜索当前项目"
              variant="ghost"
              size="sm"
            >
              <Link
                to={
                  activeProjectId
                    ? `/search?projectId=${encodeURIComponent(activeProjectId)}`
                    : "/search"
                }
              >
                <Search aria-hidden="true" className="size-4" />
              </Link>
            </IconButton>
            <ThemeMenu compact />
            <IconButton
              aria-label={
                assistantOpen ? "关闭智能助手面板" : "打开智能助手面板"
              }
              variant={assistantOpen ? "subtle" : "ghost"}
              size="sm"
              onClick={() =>
                assistantOpen ? setAssistantOpen(false) : openAssistant()
              }
            >
              {assistantOpen ? (
                <PanelRightClose aria-hidden="true" className="size-4" />
              ) : (
                <Sparkles aria-hidden="true" className="size-4" />
              )}
            </IconButton>
          </div>
        </div>
      </header>

      <main className="studio-shell-main studio-scrollbar">
        {activeProjectNotice ? (
          <p
            className="mx-5 mt-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-strong"
            role="status"
          >
            {activeProjectNotice}
          </p>
        ) : null}
        <div
          className={
            location.pathname.startsWith("/projects/")
              ? "w-full"
              : "mx-auto w-full max-w-[1440px] px-5 py-5 lg:px-7"
          }
        >
          {props.children}
        </div>
      </main>

      {wideAssistant && assistantOpen && props.assistant ? (
        <aside className="studio-shell-assistant" aria-label="尽意智能助手">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles
                aria-hidden="true"
                className="size-4 text-brand-strong"
              />
              <p className="truncate text-sm font-semibold">
                智能协作 · {activeProject?.title ?? "未选择项目"}
              </p>
            </div>
            <IconButton
              aria-label="关闭智能助手"
              variant="ghost"
              size="sm"
              onClick={() => setAssistantOpen(false)}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          <div className="studio-shell-assistant-content">
            {props.assistant}
          </div>
        </aside>
      ) : null}

      <Drawer
        open={mobileNavigationOpen}
        onOpenChange={setMobileNavigationOpen}
      >
        <Drawer.Content
          aria-label="尽意导航"
          className="w-[min(300px,calc(100vw-1rem))] overflow-hidden p-0"
        >
          <Drawer.Title className="sr-only">应用导航</Drawer.Title>
          <div className="flex h-full min-h-0 flex-col">{sidebar}</div>
        </Drawer.Content>
      </Drawer>

      <Drawer
        open={Boolean(!wideAssistant && assistantOpen && props.assistant)}
        onOpenChange={setAssistantOpen}
      >
        <Drawer.Content
          aria-label="尽意智能助手"
          closeLabel="关闭智能助手"
          className="studio-shell-assistant-drawer w-[min(560px,calc(100vw-1rem))] overflow-hidden p-0"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-line bg-surface-raised px-4 py-3">
            <Drawer.Title className="text-base">
              智能协作 · {activeProject?.title ?? "未选择项目"}
            </Drawer.Title>
          </div>
          <div className="studio-shell-assistant-content">
            {props.assistant}
          </div>
        </Drawer.Content>
      </Drawer>
    </div>
  );
}
