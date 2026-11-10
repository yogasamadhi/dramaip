/**
 * Client face of the media domain (P5-b): the production page frame
 * (`/produce`), which renders its heading and lays out the body its
 * `media.produce` slot holds, or the media object awaiting confirmation that
 * its `media.review` slot holds. Until the existing app retires (P6) the page
 * renders inside its router as a `studio.route` entry; the bodies are still
 * the app's. The read-only delivery evidence of one media record is a
 * factory (`media.delivery-evidence`, P6-h) other domain clients render.
 * @module @dramaip/production-media-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "./contract.ts";
import { DeliveryEvidence } from "./evidence/DeliveryEvidence.tsx";
import { ProducePage } from "./ProducePage.tsx";
import { en, zh } from "./locale.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The production page frame. */
    media: keyof typeof zh;
  }
}

/** Required Client services: Slots and copy. */
export const inject = ["slots", "locale"];

/**
 * Register the copy, the production page and the delivery evidence factory.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("media", { zh, en }),
    "media-client: copy",
  );
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/produce",
        locale: "media",
        registrant: "media-client",
        children: {
          "media.produce": { kind: "keyed", scope: "root" },
          "media.review": { kind: "keyed", scope: "root" },
        },
      },
      ProducePage,
    ),
  );
  ctx.slots.registerFactory(
    { name: "media.delivery-evidence", scope: "root", locale: "media" },
    DeliveryEvidence,
  );
}
