import type { DomainEntity } from "@dramaip/contracts/product";

export const productionContextKeys = [
  "adaptationId",
  "episodeId",
  "scriptId",
  "sceneId",
  "shotId",
] as const;
const kinds = ["adaptations", "episodes", "scripts", "scenes", "shots"];
export type ProductionContextKey = (typeof productionContextKeys)[number];
export type ProductionObjectContext = Partial<
  Record<ProductionContextKey, DomainEntity>
>;

export function productionReferenceKey(search: string): string {
  const params = new URLSearchParams(search);
  return JSON.stringify(
    productionContextKeys.map((key) => [key, params.getAll(key)]),
  );
}

// IDs on these three legacy-resource workspaces refer to actual Production
// records, never a formal season's stable episode key. Follow actual owner
// records upward, then check *every* declared binding before rendering a body.
export async function readProductionObjectContext(input: {
  projectId: string;
  search: string;
  get(kind: string, id: string): Promise<DomainEntity>;
}): Promise<ProductionObjectContext> {
  const params = new URLSearchParams(input.search);
  const requested = productionContextKeys.map((key) => {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length && !values[0]?.trim()))
      throw new Error("指定制作对象引用重复或为空；未替换为其他对象。");
    return values[0];
  });
  const context: ProductionObjectContext = {};
  let index = requested.length - 1;
  while (index >= 0 && !requested[index]) index -= 1;
  let id: string | undefined = requested[index];
  while (index >= 0 && id) {
    const record = await input.get(kinds[index]!, id);
    if (
      record.id !== id ||
      record.domain !== kinds[index] ||
      record.projectId !== input.projectId ||
      (requested[index] && requested[index] !== record.id) ||
      (index > 0 && !record.parentId) ||
      (index === 0 && record.parentId)
    )
      throw new Error(
        "指定制作对象的身份、项目或父级归属不符；未替换为其他对象。",
      );
    context[productionContextKeys[index]!] = record;
    id = record.parentId;
    index -= 1;
  }
  return context;
}

export function withExactProductionRecord(
  records: DomainEntity[],
  exact: DomainEntity | undefined,
): DomainEntity[] {
  // A real GET remains readable even if an older list's cap/cache omits it.
  return exact && !records.some((record) => record.id === exact.id)
    ? [exact, ...records]
    : records;
}
