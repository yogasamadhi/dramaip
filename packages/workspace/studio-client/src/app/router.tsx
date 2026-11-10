/**
 * The app's hash routes: the location lives in `window.location.hash`
 * (`#/projects/1?tab=x`), so reloads and the desktop shell keep the page.
 * It keeps the subset of the former router library the app used: route
 * patterns with `:param` and optional `:param?` segments and a `*` fallback,
 * links, redirects, and the location, navigation, parameter and search
 * hooks.
 */
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

export type To = string | { pathname?: string; search?: string; hash?: string };

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

const listeners = new Set<() => void>();
let snapshot: { href: string; location: Location } | undefined;

function readLocation(): Location {
  const href = window.location.hash;
  if (snapshot?.href === href) return snapshot.location;
  const raw = href.startsWith("#") ? href.slice(1) : href;
  const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://route");
  const state = (window.history.state as { routeState?: unknown } | null)
    ?.routeState;
  const location: Location = {
    pathname: decodeURI(url.pathname),
    search: url.search,
    hash: url.hash,
    state,
    key: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  };
  snapshot = { href, location };
  return location;
}

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("hashchange", notify);
    window.addEventListener("popstate", notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", notify);
      window.removeEventListener("popstate", notify);
    }
  };
}

function resolve(to: To, from: Location): string {
  if (typeof to !== "string")
    return `${to.pathname ?? from.pathname}${to.search ?? ""}${to.hash ?? ""}`;
  if (to.startsWith("/")) return to;
  if (to.startsWith("?")) return `${from.pathname}${to}`;
  const base = from.pathname.endsWith("/")
    ? from.pathname
    : `${from.pathname}/`;
  return new URL(to, `http://route${base}`).pathname;
}

function go(to: To | number, options: NavigateOptions = {}): void {
  if (typeof to === "number") {
    window.history.go(to);
    return;
  }
  const target = `#${resolve(to, readLocation())}`;
  const state = { ...window.history.state, routeState: options.state };
  if (options.replace) window.history.replaceState(state, "", target);
  else window.history.pushState(state, "", target);
  snapshot = undefined;
  notify();
}

const ParamsContext = createContext<Record<string, string | undefined>>({});

/**
 * Gives its subtree the current hash location. An empty hash reads as `/`
 * and stays empty in the address until the first navigation.
 */
export function HashRouter(props: { children?: ReactNode }) {
  return <>{props.children}</>;
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

export function useNavigate(): (
  to: To | number,
  options?: NavigateOptions,
) => void {
  return useCallback((to, options) => go(to, options), []);
}

export function useParams(): Record<string, string | undefined> {
  return useContext(ParamsContext);
}

export function useSearchParams(): [
  URLSearchParams,
  (
    next:
      | URLSearchParams
      | Record<string, string>
      | string
      | ((previous: URLSearchParams) => URLSearchParams),
    options?: NavigateOptions,
  ) => void,
] {
  const location = useLocation();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const set = useCallback(
    (
      next:
        | URLSearchParams
        | Record<string, string>
        | string
        | ((previous: URLSearchParams) => URLSearchParams),
      options?: NavigateOptions,
    ) => {
      const current = readLocation();
      const value =
        typeof next === "function"
          ? next(new URLSearchParams(current.search))
          : new URLSearchParams(next);
      const search = value.toString();
      go(
        { pathname: current.pathname, search: search ? `?${search}` : "" },
        options,
      );
    },
    [],
  );
  return [params, set];
}

/** Match `/projects/:projectId/tools/:toolKey?` against a pathname. */
export function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string | undefined> | undefined {
  if (pattern === "*") return {};
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  const params: Record<string, string | undefined> = {};
  let index = 0;
  for (const part of want) {
    if (part === "*") {
      params["*"] = have.slice(index).join("/");
      return params;
    }
    const optional = part.endsWith("?");
    const name = optional ? part.slice(0, -1) : part;
    const value = have[index];
    if (value === undefined) {
      if (optional) continue;
      return undefined;
    }
    if (name.startsWith(":")) params[name.slice(1)] = decodeURIComponent(value);
    else if (name !== value) {
      if (optional) continue;
      return undefined;
    }
    index += 1;
  }
  return index === have.length ? params : undefined;
}

export function Route(_props: { path: string; element: ReactNode }): null {
  return null;
}

/** Renders the first matching `Route` child. */
export function Routes(props: { children?: ReactNode }) {
  const location = useLocation();
  const routes: ReactElement<{ path: string; element: ReactNode }>[] = [];
  const collect = (children: ReactNode) =>
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Route)
        routes.push(
          child as ReactElement<{ path: string; element: ReactNode }>,
        );
      else collect((child.props as { children?: ReactNode }).children);
    });
  collect(props.children);
  for (const route of routes) {
    const params = matchPath(route.props.path, location.pathname);
    if (params)
      return (
        <ParamsContext.Provider value={params}>
          {route.props.element}
        </ParamsContext.Provider>
      );
  }
  return null;
}

export function Navigate(props: {
  to: To;
  replace?: boolean;
  state?: unknown;
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    go(props.to, {
      ...(props.replace !== undefined ? { replace: props.replace } : {}),
      state: props.state,
    });
  });
  return null;
}

export type LinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  to: To;
  replace?: boolean;
  state?: unknown;
};

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, state, onClick, target, ...props },
  ref,
) {
  const location = useLocation();
  const path = resolve(to, location);
  return (
    <a
      {...props}
      ref={ref}
      target={target}
      href={`#${path}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (target && target !== "_self")
        )
          return;
        event.preventDefault();
        go(path, {
          ...(replace !== undefined ? { replace } : {}),
          state,
        });
      }}
    />
  );
});
