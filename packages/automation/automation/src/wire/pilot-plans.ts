/**
 * The shapes the pilot plan operations declare.
 *
 * @module @dramaip/automation-automation/wire/pilot-plans
 */

/** Input of `automation/pilotPlansAction` (`pilot-plans.action`). */
export type PilotPlansActionInput = {
  action: "confirm-source" | "return-source" | "cancel" | "resume";
};

/** Answer of `automation/pilotPlansAction` (`pilot-plans.action`). */
export type PilotPlansActionResult = {
  id: string;
  projectId: string;
  chapterIds: string[];
  episodeCount: number;
  status: "draft" | "active" | "stale" | "ready-for-review" | "canceled";
  stage: "confirm-source" | "script" | "scenes" | "shots" | "assets" | "review";
  sourceConfirmed: boolean;
  adaptationId?: string;
  episodeIds: string[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
  };
  blocker?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `automation/pilotPlansCreate` (`pilot-plans.create`). */
export type PilotPlansCreateInput = {
  projectId: string;
  chapterIds: string[];
  episodeCount: number;
};

/** Answer of `automation/pilotPlansCreate` (`pilot-plans.create`). */
export type PilotPlansCreateResult = {
  id: string;
  projectId: string;
  chapterIds: string[];
  episodeCount: number;
  status: "draft" | "active" | "stale" | "ready-for-review" | "canceled";
  stage: "confirm-source" | "script" | "scenes" | "shots" | "assets" | "review";
  sourceConfirmed: boolean;
  adaptationId?: string;
  episodeIds: string[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
  };
  blocker?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `automation/pilotPlansList` (`pilot-plans.list`). */
export type PilotPlansListResult = {
  id: string;
  projectId: string;
  chapterIds: string[];
  episodeCount: number;
  status: "draft" | "active" | "stale" | "ready-for-review" | "canceled";
  stage: "confirm-source" | "script" | "scenes" | "shots" | "assets" | "review";
  sourceConfirmed: boolean;
  adaptationId?: string;
  episodeIds: string[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
  };
  blocker?: string;
  createdAt: string;
  updatedAt: string;
}[];
