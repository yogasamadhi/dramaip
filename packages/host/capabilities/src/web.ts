/**
 * Curl web reading and provider HTTP from the Host (D8). Every
 * outbound request goes through a guarded transport; credentials are
 * resolved from the vault per request and never returned.
 */

import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
} from "@dramaip/host-contracts";
import type { HostCredentials } from "./credentials.ts";
import type { HostMedia } from "./media.ts";
import { safeHttpRequest } from "./media/safe-http-transport.ts";
import { safeCurlRequest } from "./media/safe-curl-transport.ts";
import { extractSafeWebPage } from "./media/web-page-content.ts";

/** Read one public web page as bounded Markdown. */
export async function readWebPage(input: {
  url: string;
  maxCharacters: number;
}) {
  const response = await safeCurlRequest({
    url: input.url,
    maximumBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Web page returned ${response.status}`);
  const source = new TextDecoder("utf-8", { fatal: false }).decode(
    response.bytes,
  );
  const mime = response.contentType.toLowerCase().split(";", 1)[0]!.trim();
  const isHtml = mime === "text/html" || mime === "application/xhtml+xml";
  const extracted = isHtml ? extractSafeWebPage(source) : undefined;
  const converted = extracted?.markdown ?? source.trim();
  if (!converted) throw new Error("Web page did not contain readable text");
  const finalUrl = new URL(response.finalUrl);
  const title = extracted?.title ?? finalUrl.hostname.replace(/^www\./u, "");
  return {
    title,
    url: finalUrl.toString(),
    content: converted.slice(0, input.maxCharacters),
    contentType: response.contentType.slice(0, 200),
    retrievedAt: new Date().toISOString(),
    truncated: converted.length > input.maxCharacters,
  };
}

/**
 * One authenticated provider request; portrait references materialise as
 * image bytes only here.
 * @param credentials - the vault the provider credential resolves from.
 * @param media - the portraits a request references.
 * @param input - the request.
 * @returns the provider's response.
 */
export async function providerRequest(
  credentials: HostCredentials,
  media: HostMedia,
  input: ProviderHttpRequest,
): Promise<ProviderHttpResponse> {
  const secret = await credentials.resolve(input.credentialRef, {
    purpose: "provider-authentication",
    origin: new URL(input.url).origin,
  });
  if (!secret) throw new Error("服务商安全凭据不可用");
  const body = input.body ? { ...input.body } : {};
  if (input.mediaRefs?.length) {
    const referenceImages = await Promise.all(
      input.mediaRefs.map(async (mediaRef) => {
        const bytes = await media.portraitBytes(mediaRef);
        return `data:image/png;base64,${bytes.toString("base64")}`;
      }),
    );
    // Only the Host materialises media bytes. Business plugins pass opaque refs;
    // the provider request gets no source path and the project DB gets no bytes.
    body.reference_images = referenceImages;
  }
  const response = await safeHttpRequest({
    url: input.url,
    method: input.method,
    ...(Object.keys(body).length ? { body } : {}),
    accept: input.accept ?? "json",
    maximumBytes: input.maximumBytes ?? 16 * 1024 * 1024,
    timeoutMs: input.timeoutMs ?? 90_000,
    authorization: `Bearer ${secret}`,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });
  if (input.accept === "binary")
    return {
      status: response.status,
      contentType: response.contentType,
      base64: response.bytes.toString("base64"),
    };
  let json: unknown;
  try {
    json = JSON.parse(response.bytes.toString("utf8"));
  } catch {
    json = { message: response.bytes.toString("utf8").slice(0, 2_000) };
  }
  return { status: response.status, contentType: response.contentType, json };
}
