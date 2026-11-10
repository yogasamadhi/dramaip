import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export interface SafeHttpRequest {
  url: string;
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  accept: "json" | "binary" | "text" | "mcp";
  maximumBytes: number;
  timeoutMs: number;
  authorization: string;
  apiKey?: string;
  idempotencyKey?: string;
  allowHttp?: boolean;
  allowPrivateNetwork?: boolean;
  /** Host-only streaming sink. When present, response bytes are not retained in memory. */
  onChunk?: (chunk: Buffer) => void | Promise<void>;
}

export interface SafeHttpResponse {
  status: number;
  contentType: string;
  bytes: Buffer;
  finalUrl: string;
  sizeBytes: number;
}

function ipv4Parts(address: string): readonly number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split(".").map(Number);
  return parts.length === 4 ? parts : undefined;
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a = 0, b = 0, c = 0] = ipv4;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
      return false;
    return true;
  }
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (mapped) return isPublicAddress(mapped);
  // Only globally routed unicast IPv6 (2000::/3) is allowed. This
  // conservatively rejects loopback, ULA, link-local, multicast,
  // documentation and IPv4-compatible forms.
  if (!/^[23][0-9a-f]{3}:/u.test(normalized)) return false;
  if (
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2001:10:") ||
    normalized.startsWith("2001:20:") ||
    normalized.startsWith("3fff:")
  )
    return false;
  return true;
}

export async function selectPinnedAddress(
  results: readonly { address: string; family: number }[],
  allowPrivateNetwork: boolean,
): Promise<{ address: string; family: 4 | 6 }> {
  if (results.length === 0) throw new Error("Provider DNS resolution failed");
  for (const result of results)
    if (!allowPrivateNetwork && !isPublicAddress(result.address))
      throw new Error("Provider address is not publicly routable");
  const selected = results[0]!;
  if (selected.family !== 4 && selected.family !== 6)
    throw new Error("Provider DNS address family is not supported");
  return { address: selected.address, family: selected.family as 4 | 6 };
}

interface DnsAddress {
  address: string;
  family: number;
}

const publicDnsCache = new Map<
  string,
  { expiresAt: number; addresses: DnsAddress[] }
>();

function isSyntheticAddress(address: string): boolean {
  const parts = ipv4Parts(address);
  return parts?.[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

/** Resolve a proxy's synthetic DNS answer through authenticated public DNS.
 * The resolver IPs are public literals, so this cannot recurse through the
 * synthetic system resolver. Only the original hostname is sent, never a URL,
 * query, provider credential or request body. The resulting addresses still
 * pass the normal public-address policy and are pinned to the connection.
 */
async function resolveSyntheticAddress(
  hostname: string,
): Promise<DnsAddress[]> {
  const cached = publicDnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  for (const resolver of [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/resolve",
  ]) {
    try {
      const response = await safeHttpRequest({
        url: `${resolver}?name=${encodeURIComponent(hostname)}&type=A`,
        method: "GET",
        accept: "json",
        maximumBytes: 64 * 1024,
        timeoutMs: 5_000,
        authorization: "",
      });
      if (response.status !== 200) continue;
      const data = JSON.parse(response.bytes.toString("utf8")) as {
        Status?: number;
        Answer?: Array<{ type?: number; data?: string }>;
      };
      if (data.Status !== 0 || !Array.isArray(data.Answer)) continue;
      const addresses = data.Answer.flatMap((answer) =>
        answer.type === 1 &&
        typeof answer.data === "string" &&
        isIP(answer.data) === 4
          ? [{ address: answer.data, family: 4 }]
          : [],
      );
      await selectPinnedAddress(addresses, false);
      if (publicDnsCache.size >= 256)
        publicDnsCache.delete(publicDnsCache.keys().next().value!);
      publicDnsCache.set(hostname, {
        expiresAt: Date.now() + 60_000,
        addresses,
      });
      return addresses;
    } catch {
      // A second authenticated resolver may still be reachable.
    }
  }
  throw new Error("Public DNS resolution failed in proxy network");
}

export async function resolvePinnedAddress(
  url: URL,
  allowPrivateNetwork: boolean,
  lookupAll: (hostname: string) => Promise<DnsAddress[]> = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
  resolveSynthetic: (
    hostname: string,
  ) => Promise<DnsAddress[]> = resolveSyntheticAddress,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const literalFamily = isIP(hostname);
  let results = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupAll(hostname);
  if (
    !allowPrivateNetwork &&
    !literalFamily &&
    hostname.includes(".") &&
    !/(?:^|\.)(?:local|localhost|internal|lan|home)$/iu.test(hostname) &&
    results.length > 0 &&
    results.every((result) => isSyntheticAddress(result.address))
  )
    results = await resolveSynthetic(hostname);
  return selectPinnedAddress(results, allowPrivateNetwork);
}

/**
 * Node may request every DNS result from a custom lookup callback by setting
 * `all: true` (Electron's embedded Node does this for automatic family
 * selection). Preserve the DNS-pinned address while honoring both callback
 * shapes so the request cannot silently fall back to a second DNS lookup.
 */
export function createPinnedLookup(pinned: {
  address: string;
  family: 4 | 6;
}): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

export function isAllowedResponseContentType(
  contentType: string,
  accept: SafeHttpRequest["accept"],
): boolean {
  const normalized = contentType.toLowerCase().split(";", 1)[0]!.trim();
  if (accept === "json")
    return (
      normalized === "application/json" ||
      normalized === "application/dns-json" ||
      normalized.endsWith("+json")
    );
  if (accept === "mcp")
    return (
      normalized === "application/json" ||
      normalized.endsWith("+json") ||
      normalized === "text/event-stream"
    );
  if (accept === "text")
    return (
      normalized === "text/html" ||
      normalized === "application/xhtml+xml" ||
      normalized === "text/plain" ||
      normalized === "text/markdown" ||
      normalized === "text/x-markdown" ||
      normalized === "application/json" ||
      normalized.endsWith("+json")
    );
  return (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized === "application/octet-stream" ||
    normalized === "application/zip" ||
    normalized === "application/vnd.dramaip.extension" ||
    normalized === "application/json" ||
    normalized.endsWith("+json")
  );
}

async function requestOnce(
  input: SafeHttpRequest,
  url: URL,
  authorization: string | undefined,
  apiKey: string | undefined,
  idempotencyKey: string | undefined,
): Promise<SafeHttpResponse & { location?: string }> {
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && input.allowHttp))
  )
    throw new Error("Provider URL scheme is not allowed");
  const pinned = await resolvePinnedAddress(
    url,
    input.allowPrivateNetwork === true,
  );
  const body = input.body ? Buffer.from(JSON.stringify(input.body)) : undefined;
  if (body && body.byteLength > Math.min(input.maximumBytes, 4 * 1024 * 1024))
    throw new Error("Provider request body is too large");
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(
      url,
      {
        method: input.method,
        headers: {
          Accept:
            input.accept === "binary"
              ? "*/*"
              : input.accept === "text"
                ? "text/markdown, text/plain;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.7"
                : input.accept === "mcp"
                  ? "application/json, text/event-stream"
                  : "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(body.byteLength),
              }
            : {}),
          ...(authorization ? { Authorization: authorization } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          "User-Agent": "DramaIP-Desktop/3.0",
        },
        lookup: createPinnedLookup(pinned),
        signal: AbortSignal.timeout(input.timeoutMs),
      },
      (response) => {
        const status = response.statusCode ?? 502;
        const contentType = String(response.headers["content-type"] ?? "");
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({
            status,
            contentType,
            bytes: Buffer.alloc(0),
            finalUrl: url.toString(),
            sizeBytes: 0,
            location,
          });
          return;
        }
        if (!isAllowedResponseContentType(contentType, input.accept)) {
          response.destroy();
          reject(new Error("Provider response content type is not allowed"));
          return;
        }
        void (async () => {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const raw of response) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            size += chunk.byteLength;
            if (size > input.maximumBytes)
              throw new Error("Provider response is too large");
            if (input.onChunk) await input.onChunk(chunk);
            else chunks.push(chunk);
          }
          resolve({
            status,
            contentType,
            bytes: input.onChunk ? Buffer.alloc(0) : Buffer.concat(chunks),
            finalUrl: url.toString(),
            sizeBytes: size,
          });
        })().catch((error) => {
          response.destroy();
          reject(error);
        });
      },
    );
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export async function safeHttpRequest(
  input: SafeHttpRequest,
): Promise<SafeHttpResponse> {
  let url = new URL(input.url);
  const credentialOrigin = url.origin;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await requestOnce(
      input,
      url,
      url.origin === credentialOrigin ? input.authorization : undefined,
      url.origin === credentialOrigin ? input.apiKey : undefined,
      url.origin === credentialOrigin ? input.idempotencyKey : undefined,
    );
    if (!response.location) return response;
    if (redirects === 3) throw new Error("Provider redirect limit exceeded");
    url = new URL(response.location, url);
  }
  throw new Error("Provider redirect limit exceeded");
}
