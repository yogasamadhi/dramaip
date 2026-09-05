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
  Check,
  ChevronDown,
  Ellipsis,
  FolderKanban,
  Moon,
  Sparkles,
  Sun,
  X,
  Monitor,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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

function routeActive(pathname: string, target: string): boolean {
  if (target === "/") return pathname === "/";
  if (target === "/write")
    return pathname.startsWith("/write") || pathname.startsWith("/projects/");
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

export function AppShell(props: {
  children: ReactNode;
  assistant: ReactNode;
  navigation: readonly ShellNavigationItem[];
}) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const {
    projects,
    activeProject,
    activeProjectId,
    activeProjectNotice,
    selectProject,
  } = useStudioSession();
  const primaryNavigation = props.navigation
    .filter((item) => item.section === "main")
    .sort((left, right) => left.order - right.order);
  const secondaryNavigation = props.navigation
    .filter((item) => item.section === "secondary")
    .sort((left, right) => left.order - right.order);
  const moreActive = secondaryNavigation.some((item) =>
    routeActive(location.pathname, item.to),
  );
  const projectWorkspace = location.pathname.startsWith("/projects/");

  const switchProject = (projectId: string): void => {
    selectProject(projectId);
    if (location.pathname.startsWith("/projects/")) {
      navigate(`/projects/${encodeURIComponent(projectId)}`);
      return;
    }
    if (
      ["/create", "/adapt", "/produce", "/review", "/tasks"].includes(
        location.pathname,
      )
    ) {
      const search = new URLSearchParams(location.search);
      search.set("projectId", projectId);
      for (const key of [
        "adaptationId",
        "episodeId",
        "scriptId",
        "sceneId",
        "shotId",
      ])
        search.delete(key);
      navigate(`${location.pathname}?${search}`);
    }
  };

  useEffect(() => {
    const open = () => setAssistantOpen(true);
    window.addEventListener("dramaip:open-assistant-conversation", open);
    return () =>
      window.removeEventListener("dramaip:open-assistant-conversation", open);
  }, []);

  const openAssistant = (): void => {
    const event = new CustomEvent("dramaip:open-novel-assistant", {
      cancelable: true,
    });
    if (window.dispatchEvent(event)) setAssistantOpen(true);
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="app-drag-region sticky top-0 z-50 h-16 border-b border-line/80 bg-canvas/92 backdrop-blur-xl">
        <div className="app-titlebar-content flex h-full w-full items-center gap-3 px-5">
          <Link
            to="/"
            aria-label="尽意项目首页"
            className="no-drag mr-2 flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-action text-sm font-semibold text-action-contrast shadow-control"
            >
              意
            </span>
            <span className="hidden 2xl:inline">尽意 DramaIP</span>
            <span className="2xl:hidden">尽意</span>
          </Link>

          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="no-drag min-w-0 max-w-56"
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
                {activeProject && (
                  <span className="hidden shrink-0 text-[10px] text-muted xl:inline">
                    {appBarProjectModeLabel(activeProject.mode)}
                  </span>
                )}
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" aria-label="切换当前项目">
              {activeProject && (
                <DropdownMenu.Item asChild>
                  <Link
                    to={`/projects/${encodeURIComponent(activeProject.id)}/tools/cockpit`}
                  >
                    返回当前项目驾驶舱
                  </Link>
                </DropdownMenu.Item>
              )}
              {projects.map((project) => (
                <DropdownMenu.Item
                  key={project.id}
                  onSelect={() => switchProject(project.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{project.title}</span>
                    <span className="block text-[10px] text-muted">
                      {appBarProjectModeLabel(project.mode)}
                    </span>
                  </span>
                  {project.id === activeProjectId && (
                    <Check
                      aria-hidden="true"
                      className="size-4 text-brand-strong"
                    />
                  )}
                </DropdownMenu.Item>
              ))}
              {!projects.length && (
                <DropdownMenu.Item disabled>尚未创建项目</DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>

          <nav
            className="no-drag flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto py-1 studio-scrollbar"
            aria-label="主导航"
          >
            {primaryNavigation.map(({ id, to, label }) => {
              const active = routeActive(location.pathname, to);
              const destination = contextualNavigationTarget(
                to,
                activeProjectId,
              );
              return (
                <Link
                  key={id}
                  to={destination}
                  aria-current={active ? "page" : undefined}
                  className={`relative shrink-0 rounded-md px-3 py-2 text-[15px] font-medium leading-none outline-none transition focus-visible:ring-2 focus-visible:ring-focus ${active ? "bg-brand-soft text-brand-strong" : "text-muted hover:bg-surface-muted hover:text-ink"}`}
                >
                  {label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-brand"
                    />
                  ) : null}
                </Link>
              );
            })}

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
                {secondaryNavigation.map(({ id, to, label }) => {
                  const active = routeActive(location.pathname, to);
                  const destination = contextualNavigationTarget(
                    to,
                    activeProjectId,
                  );
                  return (
                    <DropdownMenu.Item key={id} asChild>
                      <Link
                        to={destination}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="flex-1">{label}</span>
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
            <ThemeMenu compact />
            <Button
              variant="primary"
              size="sm"
              aria-label="打开智能助手"
              onClick={openAssistant}
            >
              <Sparkles aria-hidden="true" className="size-4" />
              <span className="hidden xl:inline">智能助手</span>
            </Button>
          </div>
        </div>
      </header>

      <main
        className={
          projectWorkspace
            ? "w-full"
            : "mx-auto w-full max-w-[1440px] px-5 py-6 lg:px-7 lg:py-7"
        }
      >
        {activeProjectNotice && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {activeProjectNotice}
          </p>
        )}
        {props.children}
      </main>

      <Drawer open={assistantOpen} onOpenChange={setAssistantOpen}>
        <Drawer.Content
          aria-label="尽意智能助手"
          className="w-[min(560px,calc(100vw-1rem))] overflow-hidden p-0"
        >
          <div className="z-10 flex shrink-0 items-center justify-between border-b border-line bg-surface-raised/95 px-5 py-4 backdrop-blur-xl">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-brand-strong">
                尽意 DramaIP · 智能协作
              </p>
              <Drawer.Title className="mt-1">尽意智能助手</Drawer.Title>
            </div>
            <Drawer.Close asChild>
              <IconButton aria-label="关闭智能助手" variant="ghost" size="sm">
                <X aria-hidden="true" className="size-4" />
              </IconButton>
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 p-3 sm:p-4">{props.assistant}</div>
        </Drawer.Content>
      </Drawer>
    </div>
  );
}
