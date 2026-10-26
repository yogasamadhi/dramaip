import { expect, test } from "vitest";
import type { DomainEntity } from "@dramaip/contracts/product";
import {
  readProductionObjectContext,
  productionReferenceKey,
  withExactProductionRecord,
} from "./production-object-context";

const kinds = ["adaptations", "episodes", "scripts", "scenes", "shots"];
const records = kinds.map((domain, index) => ({
  id: `record-${index}`,
  domain,
  projectId: "project",
  parentId: index ? `record-${index - 1}` : undefined,
  title: domain,
  payload: { body: "not session context" },
  version: 0,
})) as DomainEntity[];
const get = async (kind: string, id: string) => {
  const value = records.find(
    (record) => record.id === id && record.domain === kind,
  );
  if (!value) throw new Error("missing");
  return value;
};
test("exact Production record resolves actual parents without selecting other records", async () => {
  const context = await readProductionObjectContext({
    projectId: "project",
    search: "?shotId=record-4",
    get,
  });
  expect(Object.values(context).map((record) => record.id)).toEqual([
    "record-4",
    "record-3",
    "record-2",
    "record-1",
    "record-0",
  ]);
  expect(
    await readProductionObjectContext({
      projectId: "project",
      search: "?stage=assets",
      get,
    }),
  ).toEqual({});
  expect(withExactProductionRecord([], records[4])).toEqual([records[4]!]);
  expect(withExactProductionRecord(records, records[4])).toEqual(records);
});
test("each declared parent, project and kind must match; failed or stable keys cannot fall back", async () => {
  for (const search of [
    "?shotId=record-4&episodeId=foreign",
    "?episodeId=stable-formal-episode",
    "?episodeId=",
    "?episodeId=record-1&episodeId=record-1",
  ]) {
    await expect(
      readProductionObjectContext({ projectId: "project", search, get }),
    ).rejects.toThrow();
  }
  await expect(
    readProductionObjectContext({
      projectId: "foreign",
      search: "?shotId=record-4",
      get,
    }),
  ).rejects.toThrow("归属不符");
  for (const patch of [
    { id: "wrong" },
    { domain: "episodes" },
    { projectId: "foreign" },
    { parentId: undefined },
  ]) {
    await expect(
      readProductionObjectContext({
        projectId: "project",
        search: "?shotId=record-4",
        get: async (kind, id) =>
          id === "record-4"
            ? { ...(await get(kind, id)), ...patch }
            : get(kind, id),
      }),
    ).rejects.toThrow("归属不符");
  }
});
test("context cache scope includes every concrete binding but not the selected stage", () => {
  expect(productionReferenceKey("?episodeId=one&stage=audio")).toBe(
    productionReferenceKey("?stage=quality&episodeId=one"),
  );
  expect(productionReferenceKey("?episodeId=one&shotId=shot")).not.toBe(
    productionReferenceKey("?episodeId=one"),
  );
  expect(productionReferenceKey("?episodeId=one&episodeId=two")).not.toBe(
    productionReferenceKey("?episodeId=one"),
  );
});
