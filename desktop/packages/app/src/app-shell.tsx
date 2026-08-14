import {
  BareButton,
  Button,
  Drawer,
  DropdownMenu,
  IconButton,
  useTheme,
  type ThemeMode,
} from "@sdns/ui";
import {
  Check,
  ChevronDown,
  Ellipsis,
  Moon,
  Sparkles,
  Sun,
  X,
  Monitor,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const PRIMARY_NAVIGATION = [
  ["/", "项目"],
  ["/write", "小说写作"],
  ["/adapt", "改编"],
  ["/produce", "制作"],
  ["/review", "审核交付"],
] as const;

const SECONDARY_NAVIGATION = [
  ["/insights", "数据洞察"],
  ["/search", "搜索"],
  ["/tasks", "任务"],
  ["/settings", "设置"],
] as const;

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

export function AppShell(props: { children: ReactNode; assistant: ReactNode }) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const location = useLocation();
  const moreActive = SECONDARY_NAVIGATION.some(([to]) =>
    routeActive(location.pathname, to),
  );
  const projectWorkspace = location.pathname.startsWith("/projects/");

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
            aria-label="DramaIP 项目首页"
            className="no-drag mr-2 flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-action text-sm font-semibold text-action-contrast shadow-control"
            >
              D
            </span>
            <span className="hidden 2xl:inline">DramaIP Studio</span>
            <span className="2xl:hidden">DramaIP</span>
          </Link>

          <nav
            className="no-drag flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto py-1 studio-scrollbar"
            aria-label="主导航"
          >
            {PRIMARY_NAVIGATION.map(([to, label]) => {
              const active = routeActive(location.pathname, to);
              return (
                <Link
                  key={to}
                  to={to}
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
                {SECONDARY_NAVIGATION.map(([to, label]) => {
                  const active = routeActive(location.pathname, to);
                  return (
                    <DropdownMenu.Item key={to} asChild>
                      <Link to={to} aria-current={active ? "page" : undefined}>
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
        {props.children}
      </main>

      <Drawer open={assistantOpen} onOpenChange={setAssistantOpen}>
        <Drawer.Content
          aria-label="DramaIP 智能助手"
          className="w-[min(560px,calc(100vw-1rem))] p-0"
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
          <div className="p-4">{props.assistant}</div>
        </Drawer.Content>
      </Drawer>
    </div>
  );
}
