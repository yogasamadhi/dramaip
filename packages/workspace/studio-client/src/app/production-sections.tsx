/**
 * Transitional (P5-c): what this app still owns of the adaptation page. The
 * production client's page frame lays the adaptation workbench out in its
 * `production.adapt` slot, which the Studio client registers until it moves
 * with its domain (P6).
 */
export {
  AdaptationWorkspace,
  type AdaptationIntro,
} from "./features/production";
/**
 * Transitional (P6-d): the production source picker the automation client's
 * creation workbench renders through its `production.narrative-sources`
 * factory before a new production run starts.
 */
export { ProductionNarrativeSelector } from "./features/production/ProductionNarrativeSelector";
