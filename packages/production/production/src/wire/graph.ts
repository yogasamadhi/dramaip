/**
 * The shapes the production graph declares.
 *
 * @module @dramaip/production-production/wire/graph
 */

/** Answer of `production/graph` (`production.graph`). */
export type GraphResult = {
  projectId: string;
  nodes: {
    id: string;
    kind: string;
    title: string;
    status: string;
  }[];
  edges: {
    sourceId: string;
    targetId: string;
    relation: string;
  }[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
    stills: number;
    adoptedStills: number;
  };
};
