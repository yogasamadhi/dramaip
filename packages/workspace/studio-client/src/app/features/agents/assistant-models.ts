import type {
  ModelProviderCatalog,
  ModelProviderCatalogModel,
} from "@dramaip/contracts/product";

/** Models from the active provider's catalog, account discovery and saved configuration. */
export function assistantProviderModels(
  provider: { payload: unknown } | undefined,
  catalog: ModelProviderCatalog | undefined,
): readonly ModelProviderCatalogModel[] {
  if (
    !provider?.payload ||
    typeof provider.payload !== "object" ||
    Array.isArray(provider.payload)
  )
    return [];
  const payload = provider.payload as Record<string, unknown>;
  const preset = catalog?.providers.find(
    (item) => item.id === payload["预设服务商"],
  );
  const models = new Map(
    (preset?.models ?? []).map((model) => [model.id, model]),
  );
  const discovered = payload["可用模型"];
  const saved = payload["模型名称"];
  const ids = [
    ...(typeof discovered === "string" ? discovered.split("、") : []),
    ...(typeof saved === "string" ? [saved] : []),
  ];
  for (const value of ids) {
    const id = value.trim();
    if (id && !models.has(id)) models.set(id, { id, label: id });
  }
  return [...models.values()];
}
