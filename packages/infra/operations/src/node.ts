/**
 * Serve a fetch-shaped handler on a `node:http` request: the body is
 * buffered, the client closing the connection aborts the request's signal,
 * and the response is written with backpressure.
 * @module @dramaip/infra-operations/node
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Answer one `node:http` request with `handler`.
 * @param req - the incoming request.
 * @param res - the response this call writes and ends.
 * @param handler - the fetch-shaped handler.
 */
export async function serveNode(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  const abort = new AbortController();
  // IncomingMessage 'close' fires once the body is read; only the response's
  // 'close' before it ended means the client went away.
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value))
      for (const each of value) headers.append(name, each);
  const method = req.method ?? "GET";
  const chunks: Buffer[] = [];
  if (method !== "GET" && method !== "HEAD")
    for await (const chunk of req) chunks.push(chunk as Buffer);
  const response = await handler(
    new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), {
      method,
      headers,
      ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      signal: abort.signal,
    }),
  );
  const outgoing: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") outgoing[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) outgoing["set-cookie"] = cookies;
  res.writeHead(response.status, outgoing);
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  abort.signal.addEventListener("abort", () => void reader.cancel(), {
    once: true,
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || abort.signal.aborted) break;
      if (!res.write(value) && !res.destroyed)
        await new Promise<void>((resolve) => {
          const done = (): void => {
            res.off("drain", done);
            res.off("close", done);
            resolve();
          };
          res.once("drain", done);
          res.once("close", done);
        });
    }
  } catch {
    // The client went away mid-stream.
  } finally {
    res.end();
  }
}
