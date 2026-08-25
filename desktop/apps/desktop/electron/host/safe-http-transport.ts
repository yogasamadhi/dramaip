import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface SafeHttpRequest {
  url: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  accept: "json" | "binary";
  maximumBytes: number;
  timeoutMs: number;
  authorization: string;
  allowHttp?: boolean;
  allowPrivateNetwork?: boolean;
}

export interface SafeHttpResponse {
  status: number;
  contentType: string;
  bytes: Buffer;
}

function ipv4Parts(address: string): readonly number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split(".").map(Number);
  return parts.length === 4 ? parts : undefined;
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
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

async function resolvePinnedAddress(
  url: URL,
  allowPrivateNetwork: boolean,
): Promise<{ address: string; family: 4 | 6 }> {
  const literalFamily = isIP(url.hostname);
  const results = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (results.length === 0) throw new Error("Provider DNS resolution failed");
  for (const result of results)
    if (!allowPrivateNetwork && !isPublicAddress(result.address))
      throw new Error("Provider address is not publicly routable");
  const selected = results[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function allowedContentType(
  contentType: string,
  accept: SafeHttpRequest["accept"],
): boolean {
  const normalized = contentType.toLowerCase().split(";", 1)[0]!.trim();
  if (accept === "json")
    return normalized === "application/json" || normalized.endsWith("+json");
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
          Accept: input.accept === "binary" ? "*/*" : "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(body.byteLength),
              }
            : {}),
          ...(authorization ? { Authorization: authorization } : {}),
          "User-Agent": "DramaIP-Desktop/3.0",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, pinned.address, pinned.family),
        signal: AbortSignal.timeout(input.timeoutMs),
      },
      (response) => {
        const status = response.statusCode ?? 502;
        const contentType = String(response.headers["content-type"] ?? "");
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({ status, contentType, bytes: Buffer.alloc(0), location });
          return;
        }
        if (!allowedContentType(contentType, input.accept)) {
          response.destroy();
          reject(new Error("Provider response content type is not allowed"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > input.maximumBytes) {
            response.destroy(new Error("Provider response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({ status, contentType, bytes: Buffer.concat(chunks) }),
        );
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
    );
    if (!response.location) return response;
    if (redirects === 3) throw new Error("Provider redirect limit exceeded");
    url = new URL(response.location, url);
  }
  throw new Error("Provider redirect limit exceeded");
}
