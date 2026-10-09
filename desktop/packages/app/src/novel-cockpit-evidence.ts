import type { StudioClient } from "@dramaip/client";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { ChapterAdoption } from "@dramaip/contracts/writing";
import type { DomainEntity } from "@dramaip/contracts/product";
import type { ManuscriptRecord } from "@dramaip/contracts/delivery";

export type NovelCockpitEvidence = {
  adoptions: ChapterAdoption[];
  workflows: CreationWorkflow[];
  memories: DomainEntity[];
  manuscripts?: ManuscriptRecord[];
};

// Follow the actual cursor to completion. The first page must not silently
// stand in for the whole book, including adopted versions and old candidates.
async function allPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("项目状态分页游标重复，不能把不完整资料标为已核验。");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

export async function loadNovelCockpitEvidence(
  client: Pick<
    StudioClient,
    "chapters" | "creation" | "resources" | "manuscripts"
  >,
  projectId: string,
): Promise<NovelCockpitEvidence> {
  const [adoptions, workflows, records, manuscripts] = await Promise.all([
    allPages((cursor) => client.chapters.adoptions(projectId, cursor)),
    allPages((cursor) => client.creation.list(projectId, undefined, cursor)),
    Promise.all(
      [
        "chapter-memories",
        "character-states",
        "story-events",
        "foreshadowings",
      ].map((domain) => client.resources.list(domain, projectId)),
    ),
    allPages((cursor) => client.manuscripts.list(projectId, cursor)),
  ]);
  return { adoptions, workflows, memories: records.flat(), manuscripts };
}
