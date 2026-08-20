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

/** Only signed, compiled loaders whose ids were enabled by the Runtime graph
 * may be resolved. Unknown server metadata never executes Renderer code. */
export function resolveBuiltinUiLoaders<TModule>(
  contributions: readonly UiContribution[],
  loaders: readonly BuiltinUiLoader<TModule>[],
): readonly BuiltinUiLoader<TModule>[] {
  const enabled = new Set(contributions.map((item) => item.id));
  return loaders.filter((loader) => enabled.has(loader.contributionId));
}
