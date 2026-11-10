import {
  GenerationCostObservationPageSchema,
  type GenerationCostObservationPage,
} from "@dramaip/contracts/insights";
export interface GenerationCostsClient {
  list(
    recordId: string,
    projectId: string,
    cursor?: number,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<GenerationCostObservationPage>;
}
export function createGenerationCostsClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): GenerationCostsClient {
  return {
    list: async (recordId, projectId, cursor, limit = 25, signal) => {
      if (
        !projectId ||
        (cursor !== undefined &&
          (!Number.isSafeInteger(cursor) || cursor <= 0)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error("费用观察须绑定原项目和有效分页范围。");
      const query = new URLSearchParams({ projectId, limit: String(limit) });
      if (cursor !== undefined) query.set("cursor", String(cursor));
      const page = GenerationCostObservationPageSchema.parse(
        await request(
          `/api/v2/generation-ledger/${encodeURIComponent(recordId)}/cost-observations?${query}`,
          { signal },
        ),
      );
      if (
        page.recordId !== recordId ||
        page.projectId !== projectId ||
        page.items.length > limit ||
        (page.observationCount > 0 &&
          cursor === undefined &&
          !page.items.length) ||
        page.items.some(
          (item, index) =>
            item.sequence > page.observationCount ||
            (cursor !== undefined && item.sequence >= cursor) ||
            (index > 0 &&
              item.sequence !== page.items[index - 1]!.sequence - 1),
        ) ||
        (page.observationCount === 0
          ? !page.legacyObservation ||
            page.items.length > 0 ||
            page.legacyObservation.source !== "legacy-unverified"
          : page.legacyObservation !== undefined) ||
        (page.nextCursor !== undefined &&
          (page.nextCursor !== page.items.at(-1)?.sequence ||
            page.nextCursor <= 1))
      )
        throw new Error("费用观察不属于原记录、项目或分页顺序。");
      return page;
    },
  };
}
