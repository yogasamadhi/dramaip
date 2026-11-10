/**
 * Transitional (P5-b): what this app still owns of the production page. The
 * media client's page frame lays the production workbench out in its
 * `media.produce` slot and the media object a review link returns to in its
 * `media.review` slot, which the Studio client registers until they move
 * with their domain (P6).
 */
export { ProductionWorkspace } from "./features/media";
export { MediaReviewReturn } from "./features/media";
