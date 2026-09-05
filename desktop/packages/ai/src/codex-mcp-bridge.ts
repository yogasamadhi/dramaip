import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export type CodexMcpGrant = {
  token: string;
  expiresAt: string;
};

export type CodexMcpBridge = {
  baseUrl: string;
  token: string;
  setGrant(grant: CodexMcpGrant | undefined): void;
  close(): Promise<void>;
};

function localRuntimeUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Codex MCP 转发目标必须是本机 HTTP Runtime");
  return url;
}

function authorized(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function forwardedHeaders(
  source: IncomingHttpHeaders,
  authorization: string,
): Headers {
  const headers = new Headers({ authorization });
  for (const name of [
    "accept",
    "content-type",
    "mcp-protocol-version",
    "mcp-session-id",
  ]) {
    const value = source[name];
    if (typeof value === "string") headers.set(name, value);
  }
  return headers;
}

async function requestBody(
  request: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw new Error("Codex MCP 请求体过大");
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startCodexMcpBridge(options: {
  targetUrl: string;
  staticToken: string;
}): Promise<CodexMcpBridge> {
  const target = localRuntimeUrl(options.targetUrl);
  const bridgeToken = randomBytes(32).toString("base64url");
  let grant: CodexMcpGrant | undefined;
  const server = createServer(async (request, response) => {
    if (!authorized(request.headers.authorization, bridgeToken)) {
      writeJson(response, 401, { error: "Codex MCP bridge token is invalid" });
      return;
    }
    if (request.url !== "/mcp") {
      writeJson(response, 404, { error: "Codex MCP bridge route not found" });
      return;
    }
    const method = request.method ?? "GET";
    if (!new Set(["GET", "POST", "DELETE"]).has(method)) {
      writeJson(response, 405, { error: "Codex MCP method is not allowed" });
      return;
    }
    try {
      const body = method === "GET" ? undefined : await requestBody(request);
      const activeGrant =
        grant && Date.parse(grant.expiresAt) > Date.now() ? grant : undefined;
      const upstream = await fetch(target, {
        method,
        headers: forwardedHeaders(
          request.headers,
          `Bearer ${activeGrant?.token ?? options.staticToken}`,
        ),
        ...(body?.length ? { body: body.toString("utf8") } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > MAX_BODY_BYTES)
        throw new Error("Codex MCP 响应体过大");
      const headers: Record<string, string> = {};
      for (const name of [
        "content-type",
        "mcp-protocol-version",
        "mcp-session-id",
      ]) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      response.writeHead(upstream.status, headers);
      response.end(bytes);
    } catch (error) {
      writeJson(response, 502, {
        error: error instanceof Error ? error.message : "Codex MCP 转发失败",
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Codex MCP 转发服务未取得本机端口");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/mcp`,
    token: bridgeToken,
    setGrant(value) {
      grant = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
