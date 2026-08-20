/**
 * Transitional product contract surface for the mature Renderer while each
 * bounded context moves its remaining UI-only types into dedicated Zod
 * modules. Consumers import this stable @dramaip/contracts subpath; the
 * historical package boundary is not exposed.
 */
export * from "../../schema/src/index.js";
