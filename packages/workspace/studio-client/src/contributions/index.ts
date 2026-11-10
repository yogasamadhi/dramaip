import type { UiContribution } from "@dramaip/plugin-api/internal";

export function contributionsOfKind<K extends UiContribution["kind"]>(
  contributions: readonly UiContribution[],
  kind: K,
): Array<UiContribution & { kind: K }> {
  return contributions.filter(
    (contribution): contribution is UiContribution & { kind: K } =>
      contribution.kind === kind,
  );
}

export interface BuiltinUiLoader<TModule = unknown> {
  readonly contributionId: string;
  readonly load: () => Promise<TModule>;
}

export interface BuiltinUiManifestEntry {
  readonly pluginId: string;
  readonly kind: UiContribution["kind"];
  readonly metadata: unknown;
  readonly metadataHash: string;
}

export interface UiContributionDiagnostic {
  readonly contributionId: string;
  readonly code:
    | "UNKNOWN_CONTRIBUTION"
    | "OWNER_MISMATCH"
    | "KIND_MISMATCH"
    | "METADATA_HASH_MISSING"
    | "METADATA_HASH_MISMATCH";
}

export function validateBuiltinUiContributions(
  contributions: readonly UiContribution[],
  manifest: Readonly<Record<string, BuiltinUiManifestEntry>>,
): {
  readonly enabled: readonly UiContribution[];
  readonly diagnostics: readonly UiContributionDiagnostic[];
} {
  const enabled: UiContribution[] = [];
  const diagnostics: UiContributionDiagnostic[] = [];
  for (const contribution of contributions) {
    const expected = manifest[contribution.id];
    let code: UiContributionDiagnostic["code"] | undefined;
    if (!expected) code = "UNKNOWN_CONTRIBUTION";
    else if (expected.pluginId !== contribution.pluginId)
      code = "OWNER_MISMATCH";
    else if (expected.kind !== contribution.kind) code = "KIND_MISMATCH";
    else if (!contribution.metadataHash) code = "METADATA_HASH_MISSING";
    else if (expected.metadataHash !== contribution.metadataHash)
      code = "METADATA_HASH_MISMATCH";
    else if (
      canonicalJson(expected.metadata) !== canonicalJson(contribution.metadata)
    )
      code = "METADATA_HASH_MISMATCH";
    if (code) diagnostics.push({ contributionId: contribution.id, code });
    else enabled.push(contribution);
  }
  return { enabled, diagnostics };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Only signed, compiled loaders whose ids were enabled by the Runtime graph
 * may be resolved. Unknown server metadata never executes Renderer code. */
export function resolveBuiltinUiLoaders<TModule>(
  contributions: readonly UiContribution[],
  loaders: readonly BuiltinUiLoader<TModule>[],
  manifest?: Readonly<Record<string, BuiltinUiManifestEntry>>,
): readonly BuiltinUiLoader<TModule>[] {
  const trusted = manifest
    ? validateBuiltinUiContributions(contributions, manifest).enabled
    : contributions;
  const enabled = new Set(trusted.map((item) => item.id));
  return loaders.filter((loader) => enabled.has(loader.contributionId));
}
