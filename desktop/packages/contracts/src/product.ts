/**
 * Transitional product contract surface for the mature Renderer while each
 * bounded context moves its remaining UI-only types into dedicated Zod
 * modules. Consumers import this stable @dramaip/contracts subpath; the
 * historical package boundary is not exposed.
 */
export * from "./product-contracts.js";
// Four-mode Renderer contracts stay on the transitional product surface while
// ownership remains in their bounded-context modules.
export type { CreatorContentRecord } from "./writing.js";
export type {
  LikenessPhoto,
  LikenessReferencePreflight,
  LikenessSubject,
} from "./media.js";
export {
  type ResearchSearchResponse,
  type ResearchTopic,
} from "./knowledge.js";
