import { expect, test } from "bun:test";
import type { Chapter, Project } from "@dramaip/contracts/product";
import {
  novelWorkspaceReferenceKey,
  readNovelWorkspaceContext,
} from "./novel-workspace-context";

const project = { id: "project" } as Project;
const original = {
  id: "original",
  projectId: project.id,
  content: "author's exact body",
  version: 4,
} as Chapter;
const second = { ...original, id: "second" };
const input = {
  projectId: project.id,
  search: "?chapterId=original",
  getProject: async () => project,
  listChapters: async () => [second],
  getChapter: async (id: string) => {
    if (id !== original.id) throw new Error("missing chapter");
    return original;
  },
};
test("explicit chapter uses its actual GET, not the first or cached directory body", async () => {
  expect(await readNovelWorkspaceContext(input)).toEqual({
    project,
    chapters: [second, original],
    chapterId: original.id,
  });
  expect(
    (
      await readNovelWorkspaceContext({
        ...input,
        listChapters: async () => [{ ...original, version: 1 }],
      })
    ).chapters,
  ).toEqual([original]);
  expect(
    await readNovelWorkspaceContext({ ...input, search: "?section=chapters" }),
  ).toEqual({ project, chapters: [second], chapterId: undefined });
});
test("unknown, foreign, empty and duplicate chapter references cannot choose another chapter", async () => {
  for (const search of [
    "?chapterId=missing",
    "?chapterId=",
    "?chapterId=original&chapterId=original",
    "?chapterId=original&projectId=other",
    "?chapterId=original&projectId=project&projectId=project",
  ])
    await expect(
      readNovelWorkspaceContext({ ...input, search }),
    ).rejects.toThrow();
  for (const patch of [{ id: "foreign" }, { projectId: "foreign" }])
    await expect(
      readNovelWorkspaceContext({
        ...input,
        getChapter: async () => ({ ...original, ...patch }),
      }),
    ).rejects.toThrow("归属不符");
});
test("project and every directory chapter are checked before returning either body", async () => {
  await expect(
    readNovelWorkspaceContext({
      ...input,
      getProject: async () => ({ ...project, id: "other" }),
    }),
  ).rejects.toThrow("归属不符");
  await expect(
    readNovelWorkspaceContext({
      ...input,
      listChapters: async () => [{ ...second, projectId: "other" }],
    }),
  ).rejects.toThrow("归属不符");
});
test("atomic snapshot identity keeps duplicates, blanks and path/query contradictions", () => {
  const key = novelWorkspaceReferenceKey(project.id, "?chapterId=original");
  expect(
    novelWorkspaceReferenceKey(
      project.id,
      "?section=chapters&chapterId=original",
    ),
  ).toBe(key);
  for (const [id, search] of [
    ["other", "?chapterId=original"],
    [project.id, "?chapterId=original&chapterId=original"],
    [project.id, "?chapterId="],
    [project.id, "?chapterId=original&projectId=other"],
  ])
    expect(novelWorkspaceReferenceKey(id, search!)).not.toBe(key);
});
