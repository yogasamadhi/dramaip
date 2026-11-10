/**
 * Slot contract of the review client: the stage bodies and the sections of
 * its review and delivery page. The page declares both when it mounts; the
 * review client registers the five stages and the episode workflow, and any
 * other client may add a section.
 * @module @dramaip/production-review-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";

declare module "@dramaip/infra-ui-slots" {
  interface SlotMap {
    /** The body of one stage of the review and delivery page (key = the stage). */
    "review.stage": {
      kind: "keyed";
      scope: "root";
      owner: ReviewStageOwnerProps;
    };
    /**
     * One section above the stages of the review and delivery page, in
     * `order`, shown once an episode is chosen.
     */
    "review.section": {
      kind: "list";
      scope: "root";
      owner: ReviewStageOwnerProps;
    };
  }
}

/** Owner share of a review stage or section: the chosen objects. */
export interface ReviewStageOwnerProps {
  /** The chosen project; empty when none is chosen. */
  projectId: string;
  /** The chosen adaptation; empty when none is chosen. */
  adaptationId: string;
  /** The chosen episode; empty when none is chosen. */
  episodeId: string;
  /** The chosen episode's title; empty when none is chosen. */
  episodeTitle: string;
}
