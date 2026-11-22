/**
 * The assistant's recommended actions for each page: one shared routing
 * layer over the agents task catalog. Only stable task ids live here; labels,
 * categories and write policy always come from the catalog, and every
 * surface that recommends actions reads this one list.
 *
 * Content tasks recommended here must either be read-only or map to a
 * creation workflow (`creationOperationForTask`), so running one from the
 * assistant never ends in a "use the workbench instead" refusal.
 */

/** A page the assistant recommends actions for. */
export type ContextPage =
  | "project"
  | "create"
  | "adapt"
  | "produce"
  | "review"
  | "tasks"
  | "settings"
  | "home";

/** One recommended action: a stable id and the catalog task it runs. */
export interface ContextActionSpec {
  /** Stable action id, also the copy key of its summary. */
  readonly actionId: string;
  readonly taskType: string;
}

/** The recommended actions of each page, in order (one to three each). */
export const CONTEXT_ACTIONS: Readonly<
  Record<ContextPage, readonly ContextActionSpec[]>
> = {
  home: [
    { actionId: "shape-project", taskType: "generate_project" },
    { actionId: "find-hook", taskType: "analyze_trope_freshness" },
  ],
  project: [
    { actionId: "diagnose-chapter", taskType: "chapter_diagnostic" },
    { actionId: "propose-bible", taskType: "propose_story_bible_changes" },
    { actionId: "build-outline", taskType: "generate_book_outline" },
  ],
  create: [
    { actionId: "character-cards", taskType: "generate_characters" },
    { actionId: "chapter-outline", taskType: "generate_chapter_outline" },
    { actionId: "quality-gate", taskType: "run_quality_gate" },
  ],
  adapt: [
    { actionId: "script-review", taskType: "review_ai_drama_script" },
    { actionId: "first-episodes", taskType: "analyze_first_10_episodes" },
  ],
  produce: [
    { actionId: "video-assets", taskType: "generate_video_asset_drafts" },
    { actionId: "image-plan", taskType: "plan_image_generation" },
    { actionId: "video-plan", taskType: "plan_video_generation" },
  ],
  review: [
    { actionId: "review-quality", taskType: "run_quality_gate" },
    { actionId: "cost-risk", taskType: "analyze_video_cost_risk" },
    { actionId: "audience-simulation", taskType: "simulate_audience_reaction" },
  ],
  tasks: [
    { actionId: "retry-diagnostic", taskType: "chapter_diagnostic" },
    { actionId: "revision-plan", taskType: "generate_revision_tasks" },
  ],
  settings: [
    { actionId: "provider-check", taskType: "analyze_video_cost_risk" },
  ],
};

/**
 * The page a route path belongs to.
 * @param pathname - the route path, without its query.
 */
export function contextPage(pathname: string): ContextPage {
  if (pathname.startsWith("/projects/")) return "project";
  if (pathname.startsWith("/write") || pathname.startsWith("/create"))
    return "create";
  if (pathname.startsWith("/adapt")) return "adapt";
  if (pathname.startsWith("/produce")) return "produce";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}
