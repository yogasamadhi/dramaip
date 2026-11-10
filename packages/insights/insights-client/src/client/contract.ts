/**
 * Slot contract of the insights client: the sections of its insights page.
 * @module @dramaip/insights-insights-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";

declare module "@dramaip/infra-ui-slots" {
  interface SlotMap {
    /**
     * One section of the insights page, in `order`. Declared by the page
     * when it mounts; the feedback revision and the outcome ledgers
     * register here.
     */
    "insights.section": {
      kind: "list";
      scope: "root";
      owner: InsightsSectionOwnerProps;
    };
  }
}

/** Owner share of an insights section. */
export interface InsightsSectionOwnerProps {
  /** The chosen project; empty when none is chosen. */
  projectId: string;
  /** The feedback cluster the author chose to revise from, if any. */
  revisionClusterId: string | undefined;
}
