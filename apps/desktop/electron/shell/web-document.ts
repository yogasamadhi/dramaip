/**
 * The application window's documents (baseline §5.2): the packaged web entry
 * served from `dramaip-app://app/`, every other application request forwarded
 * to the authenticated Desktop Host, and the shell-owned documents of
 * `dramaip-app://shell/` that never contact the Host.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export const SCHEME = "dramaip-app";
export const APP_ORIGIN = `${SCHEME}://app`;
export const SHELL_ORIGIN = `${SCHEME}://shell`;

/**
 * The `scheme://host` of a URL. Node's `URL#origin` is `"null"` for every
 * non-special scheme, the shell's own included.
 * @param url - absolute URL.
 * @returns its origin as Chromium reports it for a standard scheme.
 */
export function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** The client waits on this gate until the shell has applied the Host's injections. */
const BOOT_GATE =
  "<script>globalThis.__DRAMAIP_BOOT_READY__ = Promise.withResolvers()</script>";

/** Paths of the packaged web entry; everything else on the app origin belongs to the Host. */
export function isWebEntryPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.svg"
  );
}

/**
 * Read one packaged static file; the index gains the boot gate.
 * @param request - request on a shell-served origin.
 * @param root - directory the origin serves.
 * @returns the file, or 403 / 404 / 405.
 */
export async function serveWebDocument(
  request: Request,
  root: string,
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405 });
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response(null, { status: 400 });
  }
  const directory = resolve(root);
  const target = resolve(
    directory,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (!target.startsWith(directory + sep))
    return new Response(null, { status: 403 });
  let body: Buffer;
  try {
    body = await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response(null, { status: 404 });
    throw error;
  }
  const index = extname(target) === ".html";
  const content = index
    ? body.toString("utf8").replace("<head>", `<head>${BOOT_GATE}`)
    : new Uint8Array(body);
  return new Response(request.method === "HEAD" ? null : content, {
    headers: {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
    },
  });
}

/**
 * Exchange the Host's launch URL for its signed browser cookie. The shell
 * keeps the cookie; the page never sees it.
 * @param url - launch URL the Host reported.
 * @returns the `Cookie` header value for forwarded requests.
 */
export async function authenticateHost(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "manual" });
  const cookie = response.headers.get("set-cookie");
  await response.body?.cancel();
  if (response.status !== 303 || cookie === null)
    throw new Error("Desktop Host authentication failed");
  const end = cookie.indexOf(";");
  return end < 0 ? cookie : cookie.slice(0, end);
}

/**
 * Response headers not relayed to the page: `set-cookie` belongs to the
 * shell's own jar, and the rest describe the Node `fetch` connection rather
 * than what Chromium receives (an unencoded body's length is restored).
 */
const WITHHELD_RESPONSE_HEADERS = [
  "set-cookie",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
];

/** Client plugin bundles: the Host marks them immutable under a per-launch revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u;

/**
 * Forward one application request to the Host with the shell's cookie,
 * keeping streaming and cancellation.
 * @param request - request from the app origin.
 * @param host - the Host's origin.
 * @param cookie - the Host-issued cookie.
 * @returns the Host's response without connection-level headers.
 */
export async function forwardWebRequest(
  request: Request,
  host: string,
  cookie: string,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== APP_ORIGIN)
    return new Response(null, { status: 403 });
  const source = new URL(request.url);
  const target = new URL(host);
  target.pathname = source.pathname;
  target.search = source.search;
  const headers = new Headers(request.headers);
  for (const name of ["host", "origin", "cookie", "sec-fetch-site"])
    headers.delete(name);
  headers.set("cookie", cookie);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    redirect: "manual",
    duplex: "half",
  } as RequestInit);
  const outgoing = new Headers(response.headers);
  // Node `fetch` decodes a compressed body, so only an unencoded body keeps
  // its length; media reads check it against the record's size.
  const length = response.headers.has("content-encoding")
    ? null
    : response.headers.get("content-length");
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name);
  if (length !== null) outgoing.set("content-length", length);
  // Chromium's disk cache would only accumulate bundles no later launch reuses.
  if (PLUGIN_BUNDLE_PATH.test(source.pathname))
    outgoing.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers: outgoing,
  });
}
