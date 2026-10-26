import { expect, test } from "vitest";
import {
  MODEL_PROVIDER_CATALOG,
  MODEL_PROVIDER_CATALOG_UPDATED_AT,
  recommendedProviderModel,
} from "./provider-catalog.js";

test("常用模型服务商目录拥有唯一厂商、模型和推荐项", () => {
  expect(MODEL_PROVIDER_CATALOG.length).toBeGreaterThanOrEqual(8);
  expect(new Set(MODEL_PROVIDER_CATALOG.map((item) => item.id)).size).toBe(
    MODEL_PROVIDER_CATALOG.length,
  );
  for (const provider of MODEL_PROVIDER_CATALOG) {
    expect(provider.apiKeyUrl.startsWith("https://")).toBe(true);
    expect(provider.sourceUrl.startsWith("https://")).toBe(true);
    expect(provider.models.length).toBeGreaterThan(0);
    expect(new Set(provider.models.map((model) => model.id)).size).toBe(
      provider.models.length,
    );
    expect(recommendedProviderModel(provider).length).toBeGreaterThan(0);
  }
  expect(MODEL_PROVIDER_CATALOG_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
