import { createContext, useContext, type ReactNode } from "react";
import { useNavigate } from "./router";
import styles from "./plugin-routes.module.css";

/**
 * Renders the page a client plugin registered for one route path, or nothing
 * when no plugin took that path. `navigate` moves the app's own router.
 */
export type PluginRouteRenderer = (
  path: string,
  navigate: (path: string) => void,
) => ReactNode;

const PluginRouteContext = createContext<PluginRouteRenderer | undefined>(
  undefined,
);

/**
 * Transitional (P4/P5): the pages the domain client plugins took over render
 * inside this app's router and providers until the app itself is retired in
 * P6.
 */
export function PluginRouteProvider(props: {
  render: PluginRouteRenderer | undefined;
  children: ReactNode;
}) {
  return (
    <PluginRouteContext.Provider value={props.render}>
      {props.children}
    </PluginRouteContext.Provider>
  );
}

/**
 * The plugin page for `path`, rendered at the route's place in the app. A
 * `workbench` page keeps the workbench palette its old page set around it.
 */
export function PluginRoute(props: { path: string; workbench?: boolean }) {
  const render = useContext(PluginRouteContext);
  const navigate = useNavigate();
  const page = render?.(props.path, (path) => navigate(path)) ?? null;
  return props.workbench ? (
    <div className={styles.c1}>{page}</div>
  ) : (
    <>{page}</>
  );
}
