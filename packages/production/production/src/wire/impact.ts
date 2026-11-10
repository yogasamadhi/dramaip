/**
 * The shapes the impact operation declares.
 *
 * @module @dramaip/production-production/wire/impact
 */

/** Input of `production/impact` (`production.impact`). */
export type ImpactInput = {
  projectId: string;
  sourceId: string;
};

/** Answer of `production/impact` (`production.impact`). */
export type ImpactResult = {
  sourceId: string;
  affected: {
    id: string;
    kind: string;
    title: string;
    status: string;
  }[];
  summary: string;
};
