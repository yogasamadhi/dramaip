/** Bounded public HTTPS reads through curl, with DNS pinning on every hop. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isAllowedResponseContentType,
  resolvePinnedAddress,
  type SafeHttpResponse,
} from "./safe-http-transport.ts";

const executeFile = promisify(execFile);
const HEADER_LIMIT = 64 * 1024;

interface CurlRead {
  url: string;
  maximumBytes: number;
  timeoutMs: number;
}

interface CurlDependencies {
  resolveAddress: typeof resolvePinnedAddress;
  execute(args: string[], input: CurlRead): Promise<Buffer>;
}

async function executeCurl(args: string[], input: CurlRead): Promise<Buffer> {
  try {
    const result = await executeFile(
      process.platform === "darwin" ? "/usr/bin/curl" : "curl",
      args,
      {
        encoding: "buffer",
        timeout: input.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: input.maximumBytes + HEADER_LIMIT,
        windowsHide: true,
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.platform === "win32" && process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
          LANG: "C.UTF-8",
        },
      },
    );
    return result.stdout;
  } catch (cause) {
    const failure = cause as { code?: unknown; killed?: boolean };
    if (failure.code === "ENOENT")
      throw new Error("系统中未找到 curl，请安装 curl 后重试。");
    if (failure.killed || failure.code === 28)
      throw new Error("curl network request timed out");
    if (
      failure.code === 63 ||
      failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    )
      throw new Error("Web page response is too large");
    // curl's raw stderr may include a URL or proxy details. Keep it out of model events.
    throw new Error("curl network request failed");
  }
}

function curlResponse(
  bytes: Buffer,
  url: URL,
  maximumBytes: number,
): SafeHttpResponse & { location?: string } {
  let offset = 0;
  while (
    /^HTTP\/\S+\s+1\d\d(?:\s|$)/u.test(
      bytes.subarray(offset, offset + 40).toString("latin1"),
    )
  ) {
    const interimEnd = bytes.indexOf("\r\n\r\n", offset);
    if (interimEnd < 0 || interimEnd > HEADER_LIMIT)
      throw new Error("curl returned invalid HTTP headers");
    offset = interimEnd + 4;
  }
  const end = bytes.indexOf("\r\n\r\n", offset);
  if (end < 0 || end > HEADER_LIMIT)
    throw new Error("curl returned invalid HTTP headers");
  const lines = bytes.subarray(offset, end).toString("latin1").split("\r\n");
  const status = Number(
    /^HTTP\/\S+\s+(\d{3})(?:\s|$)/u.exec(lines.shift() ?? "")?.[1],
  );
  if (!status) throw new Error("curl returned invalid HTTP status");
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0)
      headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  const body = bytes.subarray(end + 4);
  if (body.byteLength > maximumBytes)
    throw new Error("Web page response is too large");
  const contentType = headers.get("content-type") ?? "";
  const location =
    status >= 300 && status < 400 ? headers.get("location") : null;
  if (!location && !isAllowedResponseContentType(contentType, "text"))
    throw new Error("Web page response content type is not allowed");
  return {
    status,
    contentType,
    bytes: body,
    finalUrl: url.toString(),
    sizeBytes: body.byteLength,
    ...(location ? { location } : {}),
  };
}

/** Use curl's GET transport without loading curlrc, a shell, credentials or local files. */
export async function safeCurlRequest(
  input: CurlRead,
  dependencies: CurlDependencies = {
    resolveAddress: resolvePinnedAddress,
    execute: executeCurl,
  },
): Promise<SafeHttpResponse> {
  let url = new URL(input.url);
  const deadline = Date.now() + input.timeoutMs;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Provider URL scheme is not allowed");
    const pinned = await dependencies.resolveAddress(url, false);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("curl network request timed out");
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const address =
      pinned.family === 6 ? `[${pinned.address}]` : pinned.address;
    const args = [
      "--disable",
      "--silent",
      "--show-error",
      "--include",
      "--compressed",
      "--globoff",
      "--noproxy",
      "*",
      "--proto",
      "=https",
      "--max-time",
      String(remainingMs / 1000),
      "--connect-timeout",
      String(Math.min(remainingMs / 1000, 8)),
      "--max-filesize",
      String(input.maximumBytes),
      "--resolve",
      `${pinned.family === 6 && hostname.includes(":") ? `[${hostname}]` : hostname}:${url.port || "443"}:${address}`,
      "--header",
      "Accept: text/markdown, text/plain;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.7, application/json;q=0.7",
      "--user-agent",
      "DramaIP-Desktop/3.0",
      "--url",
      url.toString(),
    ];
    const response = curlResponse(
      await dependencies.execute(args, { ...input, timeoutMs: remainingMs }),
      url,
      input.maximumBytes,
    );
    if (!response.location) return response;
    if (redirects === 3) throw new Error("Provider redirect limit exceeded");
    url = new URL(response.location, url);
  }
  throw new Error("Provider redirect limit exceeded");
}
