import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@dramaip/infra-ui-slots";
import { MediaReviewReturn, ProductionWorkspace } from "../app/media-sections";
import type {} from "./contract.ts";

/** The media review return, under the heading copy the page frame hands it. */
function ReviewBody(props: PropsRuntime<"media.review">) {
  return (
    <MediaReviewReturn title={props.title} description={props.description} />
  );
}

/**
 * Register the media page bodies the existing app still owns into the page
 * frame the media client declares: the production workbench and the media
 * object a review link returns to. Transitional until they move (P6).
 * @param ctx - Client Context whose Slot registry the page declares into.
 */
export function registerLegacyMediaPages(ctx: Context): void {
  ctx.slots.inject("media.produce", () => [
    ctx.slots.register(
      {
        name: "media.produce",
        key: "body",
        registrant: "workspace-studio-client",
      },
      ProductionWorkspace,
    ),
  ]);
  ctx.slots.inject("media.review", () => [
    ctx.slots.register(
      {
        name: "media.review",
        key: "body",
        registrant: "workspace-studio-client",
      },
      ReviewBody,
    ),
  ]);
}
