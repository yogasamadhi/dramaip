/**
 * Client face of the review domain: the review and delivery page frame,
 * which checks the objects the address names, offers the project,
 * adaptation and episode choice and the stage navigation, and lays out the
 * chosen stage's `review.stage` entry under every `review.section`; and the
 * native bodies of its five stages and the episode workflow section. Until
 * the existing app retires the page renders inside its router as the
 * `/review` `studio.route` entry and reads the app's scope through the
 * route's owner share.
 * @module @dramaip/production-review-client/client
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation-client/client/contract";
import type {} from "@dramaip/infra-locale/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import type {} from "@dramaip/production-media-client/client/contract";
import type {} from "@dramaip/workspace-workspace-client/client/contract";
import type {} from "./contract.ts";
import { en, zh } from "./locale.ts";
import type { StageRemotes } from "./remote.ts";
import { ReviewPage } from "./ReviewPage.tsx";
import { EpisodeWorkflow } from "./stages/EpisodeWorkflow.tsx";
import { STAGES } from "./stages/Stages.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The review and delivery page frame and its stages. */
    review: keyof typeof zh;
  }
}

/** Required Client services: Slots, copy and the stages' Remote namespaces. */
export const inject = [
  "slots",
  "locale",
  "remote",
  "remote.review",
  "remote.delivery",
  "remote.media",
  "remote.timeline",
  "remote.automation",
  "remote.production",
  "remote.quality",
  "remote.system",
];

/**
 * Register the copy, the review and delivery page, its five stage bodies
 * and the episode workflow above them.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register("review", { zh, en }),
    "review-client: copy",
  );
  ctx.slots.inject("studio.route", () =>
    ctx.slots.register(
      {
        name: "studio.route",
        key: "/review",
        locale: "review",
        registrant: "review-client",
        children: {
          "review.stage": { kind: "keyed", scope: "root" },
          "review.section": { kind: "list", scope: "root" },
        },
      },
      ReviewPage,
    ),
  );
  const remotes = (): StageRemotes => ({
    review: ctx.remote.review,
    delivery: ctx.remote.delivery,
    media: ctx.remote.media,
    timeline: ctx.remote.timeline,
    automation: ctx.remote.automation,
    production: ctx.remote.production,
    quality: ctx.remote.quality,
    system: ctx.remote.system,
  });
  ctx.slots.inject("review.stage", () =>
    Object.entries(STAGES).map(([key, component]) =>
      ctx.slots.register(
        {
          name: "review.stage",
          key,
          locale: "review",
          registrant: "review-client",
          inject: remotes,
        },
        component,
      ),
    ),
  );
  ctx.slots.inject("review.section", () =>
    ctx.slots.register(
      {
        name: "review.section",
        id: "review-episode-workflow",
        order: 10,
        locale: "review",
        registrant: "review-client",
        inject: () => ({ automation: ctx.remote.automation }),
      },
      EpisodeWorkflow,
    ),
  );
}
