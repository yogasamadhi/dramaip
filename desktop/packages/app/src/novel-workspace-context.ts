import type { Chapter, Project } from "@dramaip/contracts/product";

export function novelWorkspaceReferenceKey(
  projectId: string | undefined,
  search: string,
): string {
  const params = new URLSearchParams(search);
  return JSON.stringify([
    projectId,
    params.getAll("projectId"),
    params.getAll("chapterId"),
  ]);
}

// A directory is not permission to replace an explicitly requested chapter.
// Read its owner directly, then publish the project/directory as one snapshot.
export async function readNovelWorkspaceContext(input: {
  projectId: string;
  search: string;
  getProject(id: string): Promise<Project>;
  listChapters(projectId: string): Promise<Chapter[]>;
  getChapter(id: string): Promise<Chapter>;
}): Promise<{ project: Project; chapters: Chapter[]; chapterId?: string }> {
  const params = new URLSearchParams(input.search);
  const projectIds = params.getAll("projectId");
  const chapterIds = params.getAll("chapterId");
  if (
    !input.projectId ||
    projectIds.length > 1 ||
    (projectIds.length && projectIds[0] !== input.projectId) ||
    chapterIds.length > 1 ||
    (chapterIds.length && !chapterIds[0]?.trim())
  )
    throw new Error("指定项目或章节引用重复、为空或与路由身份不符。");
  const chapterId = chapterIds[0];
  const [project, directory, chapter] = await Promise.all([
    input.getProject(input.projectId),
    input.listChapters(input.projectId),
    chapterId ? input.getChapter(chapterId) : undefined,
  ]);
  if (
    project.id !== input.projectId ||
    directory.some((item) => item.projectId !== input.projectId) ||
    (chapterId &&
      (!chapter ||
        chapter.id !== chapterId ||
        chapter.projectId !== input.projectId))
  )
    throw new Error("指定项目或章节的实际身份、归属不符。");
  const chapters = chapter
    ? directory.some((item) => item.id === chapter.id)
      ? directory.map((item) => (item.id === chapter.id ? chapter : item))
      : [...directory, chapter]
    : directory;
  return { project, chapters, chapterId };
}
