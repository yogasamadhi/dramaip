import type { ComponentType } from "react";
import type { IconProps } from "@dramaip/infra-ui-primitives";
import {
  Button,
  Drawer,
  DropdownMenu,
  IconButton,
  Tooltip,
} from "@dramaip/infra-ui-primitives";
import { useTheme, type ThemeMode } from "./theme-mode";
import {
  IconShieldCheckOutlineRegular as BadgeCheck,
  IconChartOutlineRegular as BarChart3,
  IconBookOutlineRegular as BookOpenText,
  IconCheckOutlineRegular as Check,
  IconChevronDownOutlineRegular as ChevronDown,
  IconClapperboardOutlineRegular as Clapperboard,
  IconFilmOutlineRegular as Film,
  IconFolderOpenOutlineRegular as FolderKanban,
  IconLayoutOutlineRegular as LayoutDashboard,
  IconLibraryOutlineRegular as LibraryBig,
  IconLightbulbOutlineRegular as Lightbulb,
  IconChecklistOutlineRegular as ListTodo,
  IconFlatListOutlineRegular as Menu,
  IconDarkOutlineRegular as Moon,
  IconPanelLeftCloseOutlineRegular as PanelLeftClose,
  IconPanelLeftOpenOutlineRegular as PanelLeftOpen,
  IconPanelRightCloseOutlineRegular as PanelRightClose,
  IconSearchOutlineRegular as Search,
  IconSettingsOutlineRegular as Settings,
  IconSparkleRegular as Sparkles,
  IconLightOutlineRegular as Sun,
  IconEnhanceOutlineRegular as WandSparkles,
  IconCloseOutlineRegular as X,
  IconFollowsystemOutlineRegular as Monitor,
} from "@dramaip/infra-ui-primitives";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "./router";
import { contextualNavigationTarget, useStudioSession } from "./studio-session";
import styles from "./app-shell.module.css";
import { copyText } from "./copy";
import { clsx } from "clsx";

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

const SHELL_LAYOUT_KEY = "dramaip-shell-layout:v2";
const LEGACY_SHELL_LAYOUT_KEY = "dramaip-shell-layout:v1";
const NAV_ICON: Record<string, ComponentType<IconProps>> = {
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
]);
const GLOBAL_ROUTES = new Set([
  "/",
  "/inspiration",
  "/search",
  "/tasks",
  "/pending",
  "/insights",
  "/settings",
]);

function storedLayout(): {
  navigationCollapsed: boolean;
  assistantOpen: boolean;
} {
  try {
    const current = window.localStorage.getItem(SHELL_LAYOUT_KEY);
    const value = JSON.parse(
      current ?? window.localStorage.getItem(LEGACY_SHELL_LAYOUT_KEY) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object")
      return { navigationCollapsed: true, assistantOpen: false };
    const record = value as Record<string, unknown>;
    return {
      // Apply the compact default once to older layouts; retain subsequent
      // explicit choices and the existing assistant preference.
      navigationCollapsed:
        current === null || record.navigationCollapsed !== false,
      assistantOpen: record.assistantOpen === true,
    };
  } catch {
    return { navigationCollapsed: true, assistantOpen: false };
  }
}

function routeActive(pathname: string, target: string): boolean {
  if (target === "/") return pathname === "/";
  if (target === "/write")
    return (
      pathname.startsWith("/write") ||
      pathname.startsWith("/create") ||
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

const ADAPTATION_TOOLS = new Set([
  "adaptation-diagnosis",
  "adaptation-strategy",
  "season-plan",
  "episode-development",
  "pilot",
  "series",
]);

/** Breadcrumb labels come from the same navigation contributions as the sidebar. */
function workAreaLabel(
  pathname: string,
  navigation: readonly ShellNavigationItem[],
): string {
  const labelFor = (to: string, fallback: string): string =>
    navigation.find((item) => item.to === to)?.label ?? fallback;
  const tool = /^\/projects\/[^/]+\/tools\/([^/?]+)/.exec(pathname)?.[1];
  if (tool === "cockpit") return "概览";
  if (tool && ADAPTATION_TOOLS.has(tool)) return labelFor("/adapt", "改编");
  if (tool === "review") return labelFor("/review", "审核交付");
  if (pathname.startsWith("/projects/")) return labelFor("/write", "故事");
  if (pathname.startsWith("/create"))
    return `${labelFor("/write", "故事")} / 创作分析`;
  const match = navigation
    .filter((item) => item.to !== "/" && pathname.startsWith(item.to))
    .sort((left, right) => right.to.length - left.to.length)[0];
  return match?.label ?? "项目库";
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
          <IconButton
            aria-label={copyText("app/app-shell.1")}
            variant="ghost"
            size="sm"
          >
            <ActiveThemeIcon aria-hidden="true" className={styles.c1} />
          </IconButton>
        ) : (
          <Button variant="ghost" size="sm">
            <ActiveThemeIcon aria-hidden="true" className={styles.c2} />
            {copyText("app/app-shell.2")}
            <ChevronDown aria-hidden="true" className={styles.c3} />
          </Button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align="end"
        aria-label={copyText("app/app-shell.3")}
      >
        <DropdownMenu.Label className={styles.c4}>
          {copyText("app/app-shell.3")}
        </DropdownMenu.Label>
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => setMode(option.value)}
            >
              <Icon aria-hidden="true" className={styles.c5} />
              <span className={styles.c6}>{option.label}</span>
              {mode === option.value ? (
                <Check aria-hidden="true" className={styles.c7} />
              ) : null}
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu>
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
  const label = props.label ?? props.item.label;
  return (
    <Tooltip
      label={label}
      delayMs={0}
      focusDelayMs={0}
      side="right"
      portal
      disabled={!props.collapsed}
    >
      <Link
        to={props.to}
        aria-label={label}
        aria-current={props.active ? "page" : undefined}
        className={clsx(styles.c8, props.active ? styles.k1 : "")}
      >
        <Icon aria-hidden="true" className={styles.c9} />
        <span className={styles.c10}>{label}</span>
      </Link>
    </Tooltip>
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
      <div className={styles.c11}>
        <Link
          to="/"
          aria-label={copyText("app/app-shell.4")}
          className={styles.c12}
        >
          <span className={clsx(styles.c14, styles.brandWordmark)}>
            <strong>{copyText("app/app-shell.brand-name")}</strong>
            <small>{copyText("app/app-shell.brand-subtitle")}</small>
          </span>
        </Link>
      </div>
      <div className={styles.c16}>
        <nav aria-label={copyText("app/app-shell.7")} className={styles.c17}>
          <p className={styles.c18}>{copyText("app/app-shell.8")}</p>
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
          <nav aria-label={copyText("app/app-shell.9")} className={styles.c19}>
            <p className={styles.c18}>{copyText("app/app-shell.10")}</p>
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
      <div className={styles.sidebarFooter}>
        <Sparkles aria-hidden="true" />
        <span className={styles.c14}>
          {copyText("app/app-shell.brand-tagline")}
        </span>
      </div>
    </>
  );

  return (
    <div
      className={clsx(
        styles.c20,
        isMacOS ? styles.k3 : "",
        navigationCollapsed ? styles.k4 : "",
        assistantOpen && props.assistant ? styles.k5 : "",
      )}
    >
      <aside className={styles.c21}>{sidebar}</aside>

      <header className={styles.c22}>
        <div className={styles.c23}>
          <IconButton
            className={styles.c24}
            aria-label={copyText("app/app-shell.11")}
            variant="ghost"
            size="sm"
            onClick={() => setMobileNavigationOpen(true)}
          >
            <Menu aria-hidden="true" className={styles.c2} />
          </IconButton>
          <IconButton
            className={styles.c15}
            aria-label={navigationCollapsed ? "展开导航" : "收起导航"}
            variant="ghost"
            size="sm"
            onClick={() => setNavigationCollapsed((value) => !value)}
          >
            {navigationCollapsed ? (
              <PanelLeftOpen aria-hidden="true" className={styles.c2} />
            ) : (
              <PanelLeftClose aria-hidden="true" className={styles.c2} />
            )}
          </IconButton>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={styles.c25}
                aria-label={
                  activeProject
                    ? `当前项目：${activeProject.title}`
                    : "当前没有项目"
                }
              >
                <FolderKanban aria-hidden="true" className={styles.c26} />
                <span className={styles.c27}>
                  {activeProject?.title ?? "选择项目"}
                </span>
                <ChevronDown aria-hidden="true" className={styles.c28} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              aria-label={copyText("app/app-shell.12")}
            >
              {projects.map((project) => (
                <DropdownMenu.Item
                  key={project.id}
                  onSelect={() => switchProject(project.id)}
                >
                  <span className={styles.c29}>
                    <span className={styles.c30}>{project.title}</span>
                    <span className={styles.c31}>
                      {appBarProjectModeLabel(project.mode)}
                    </span>
                  </span>
                  {project.id === activeProjectId ? (
                    <Check aria-hidden="true" className={styles.c7} />
                  ) : null}
                </DropdownMenu.Item>
              ))}
              {!projects.length ? (
                <DropdownMenu.Item disabled>
                  {copyText("app/app-shell.13")}
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu>
          <span aria-hidden="true" className={styles.c32}>
            /
          </span>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" className={styles.c33}>
                <span className={styles.c27}>
                  {workAreaLabel(location.pathname, props.navigation)}
                </span>
                {trail.length ? (
                  <span className={styles.c34}>/ {trail.at(-1)?.label}</span>
                ) : null}
                <ChevronDown aria-hidden="true" className={styles.c3} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              aria-label={copyText("app/app-shell.14")}
            >
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
          <div className={styles.c35}>
            <IconButton
              asChild
              aria-label={copyText("app/app-shell.15")}
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
                <Search aria-hidden="true" className={styles.c2} />
              </Link>
            </IconButton>
            <ThemeMenu compact />
            {assistantOpen ? (
              <IconButton
                aria-label={copyText("app/app-shell.16")}
                variant="subtle"
                size="sm"
                onClick={() => setAssistantOpen(false)}
              >
                <PanelRightClose aria-hidden="true" className={styles.c2} />
              </IconButton>
            ) : (
              <Button
                aria-label={copyText("app/app-shell.17")}
                variant="secondary"
                size="sm"
                onClick={openAssistant}
              >
                <Sparkles aria-hidden="true" className={styles.c36} />
                {copyText("app/app-shell.18")}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className={styles.c37}>
        {activeProjectNotice ? (
          <p className={styles.c38} role="status">
            {activeProjectNotice}
          </p>
        ) : null}
        <div
          className={
            location.pathname.startsWith("/projects/") ? styles.c39 : styles.c40
          }
        >
          {props.children}
        </div>
      </main>

      {wideAssistant && assistantOpen && props.assistant ? (
        <aside className={styles.c41} aria-label={copyText("app/app-shell.19")}>
          <div className={styles.c42}>
            <div className={styles.c43}>
              <Sparkles aria-hidden="true" className={styles.c7} />
              <p className={styles.c44}>
                {copyText("app/app-shell.20")}
                {activeProject?.title ?? "未选择项目"}
              </p>
            </div>
            <IconButton
              aria-label={copyText("app/app-shell.21")}
              variant="ghost"
              size="sm"
              onClick={() => setAssistantOpen(false)}
            >
              <X aria-hidden="true" className={styles.c2} />
            </IconButton>
          </div>
          <div className={styles.c45}>{props.assistant}</div>
        </aside>
      ) : null}

      <Drawer
        open={mobileNavigationOpen}
        onOpenChange={setMobileNavigationOpen}
      >
        <Drawer.Content
          aria-label={copyText("app/app-shell.22")}
          className={styles.c46}
        >
          <Drawer.Title className={styles.c47}>
            {copyText("app/app-shell.23")}
          </Drawer.Title>
          <div className={styles.c48}>{sidebar}</div>
        </Drawer.Content>
      </Drawer>

      <Drawer
        open={Boolean(!wideAssistant && assistantOpen && props.assistant)}
        onOpenChange={setAssistantOpen}
      >
        <Drawer.Content
          aria-label={copyText("app/app-shell.19")}
          closeLabel="关闭智能助手"
          className={styles.c49}
        >
          <div className={styles.c50}>
            <Drawer.Title className={styles.c51}>
              {copyText("app/app-shell.20")}
              {activeProject?.title ?? "未选择项目"}
            </Drawer.Title>
          </div>
          <div className={styles.c45}>{props.assistant}</div>
        </Drawer.Content>
      </Drawer>
    </div>
  );
}
