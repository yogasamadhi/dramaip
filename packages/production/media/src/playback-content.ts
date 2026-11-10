/**
 * The media playback content route. Its answer is the media bytes, not JSON,
 * so it keeps its `/api/v2` URL instead of becoming a Remote method: this
 * plugin claims the operation from the operation registry, owns the
 * `/api/v2/media-records` prefix on the web server, and runs the media
 * plugin's handler in process with the request's query and `If-Match`. Every
 * other path under the prefix is a Remote method of the `media` namespace and
 * answers 404 here.
 * @module @dramaip/production-media/playback-content
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { serveNode } from "@dramaip/infra-operations";
import { claimCompatOperations } from "@dramaip/infra-operations/operations";
import type {} from "@dramaip/infra-connection";
import type {} from "@dramaip/infra-webserver";

const PREFIX = "/api/v2/media-records";
const CONTENT = /^\/api\/v2\/media-records\/([^/]+)\/playback\/content$/u;
const OPERATION = "media-playback.read";

/** Answer what is not the content route, as an unrouted path answers. */
function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Serves `GET /api/v2/media-records/{id}/playback/content`.
 * @replaces media-playback.read
 */
export const PlaybackContentRoute = {
  name: "media-playback-content",
  inject: ["operations", "webServer", "connection"],
  apply(ctx: Context): void {
    const compat = claimCompatOperations(ctx, [OPERATION]);
    const answer = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const match = CONTENT.exec(url.pathname);
      if (match === null || request.method !== "GET") return notFound();
      const ifMatch = request.headers.get("if-match") ?? undefined;
      return compat.fetch(
        OPERATION,
        {
          params: { id: decodeURIComponent(match[1]!) },
          query: Object.fromEntries(url.searchParams),
          ...(ifMatch === undefined ? {} : { ifMatch }),
        },
        request.headers.get("accept") ?? "*/*",
      );
    };
    const handler = async (
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<void> => {
      const admission = ctx.connection.admit(req);
      if ("rejection" in admission) {
        res.writeHead(admission.rejection);
        res.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
        return;
      }
      await serveNode(req, res, answer);
    };
    ctx.effect(
      () => ctx.webServer.register({ kind: "prefix", path: PREFIX, handler }),
      "production-media: playback content route",
    );
  },
};
