import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";
import type { loadLayeredEnv } from "@dramaip/infra-app-boot";

type LaunchEnvironment = ReturnType<typeof loadLayeredEnv>;
const PROXY_NAMES = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
] as const;

/** macOS GUI launches do not inherit the network preferences of the browser. */
export function macSystemProxyEnvironment(
  output: string,
): Record<string, string> {
  const properties = new Map(
    [...output.matchAll(/^ {2}(\w+) : ([^\n]+)$/gm)].map(([, name, value]) => [
      name,
      value?.trim(),
    ]),
  );
  const environment: Record<string, string> = {};
  // PAC selects a route per URL and cannot be represented by proxy variables.
  if (
    properties.get("ProxyAutoConfigEnable") === "1" ||
    properties.get("ProxyAutoDiscoveryEnable") === "1"
  )
    return environment;

  for (const scheme of ["HTTP", "HTTPS"] as const) {
    if (properties.get(`${scheme}Enable`) !== "1") continue;
    const host = properties.get(`${scheme}Proxy`);
    const port = Number(properties.get(`${scheme}Port`));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    try {
      const authority = isIP(host) === 6 ? `[${host}]` : host;
      const url = new URL(`http://${authority}:${port}`);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        continue;
      environment[`${scheme}_PROXY`] = url.origin;
    } catch {
      // A malformed system setting does not prevent the Host from starting.
    }
  }
  if (Object.keys(environment).length > 0) {
    const exceptions =
      /^ {2}ExceptionsList : <array> \{\n([\s\S]*?)^ {2}\}/m.exec(
        output,
      )?.[1] ?? "";
    const bypass = [...exceptions.matchAll(/^ {4}\d+ : ([^\n]+)$/gm)].map(
      ([, value]) => value?.trim(),
    );
    if (properties.get("ExcludeSimpleHostnames") === "1")
      bypass.push("<local>");
    if (bypass.length) environment.NO_PROXY = bypass.join(",");
  }
  return environment;
}

export async function withDesktopSystemProxy(
  environment: LaunchEnvironment,
): Promise<LaunchEnvironment> {
  if (
    process.platform !== "darwin" ||
    PROXY_NAMES.some((name) => environment.get(name)?.value.trim())
  )
    return environment;
  try {
    const { stdout } = await promisify(execFile)(
      "/usr/sbin/scutil",
      ["--proxy"],
      {
        timeout: 2_000,
        maxBuffer: 64 * 1024,
      },
    );
    const fallback = macSystemProxyEnvironment(stdout);
    const getDefault = (name: string) =>
      Object.hasOwn(fallback, name)
        ? { value: fallback[name]!, source: "process" as const }
        : undefined;
    return {
      get: (name) => environment.get(name) ?? getDefault(name),
      getFrom: (name, sources) =>
        environment.getFrom(name, sources) ??
        (sources.includes("process") ? getDefault(name) : undefined),
    };
  } catch {
    return environment;
  }
}
