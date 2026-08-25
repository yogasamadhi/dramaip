import type { UiContributionMetadata } from "@dramaip/contracts";
import {
  validateBuiltinUiContributions,
  type UiContributionDiagnostic,
} from "@dramaip/ui-runtime";
import { BUILTIN_UI_MANIFEST } from "./builtin-manifest.generated";

export interface BuiltinContributionSet {
  readonly enabled: readonly UiContributionMetadata[];
  readonly diagnostics: readonly UiContributionDiagnostic[];
}

/**
 * The Runtime can enable a compiled contribution, but it cannot introduce
 * Renderer code. Only exact id/owner/kind/metadata-hash matches from this
 * generated, signed-at-build manifest become visible to routing or slots.
 */
export function resolveBuiltinContributionSet(
  contributions: readonly UiContributionMetadata[],
): BuiltinContributionSet {
  return validateBuiltinUiContributions(
    contributions,
    BUILTIN_UI_MANIFEST,
  ) as BuiltinContributionSet;
}
