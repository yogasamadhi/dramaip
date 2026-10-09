import type { StudioClient } from "@dramaip/client";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AuthorIntentCurrent } from "@dramaip/contracts/workspace";
import type {
  EpisodeDevelopmentCatalog,
  EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import type { PilotPackageRecord } from "@dramaip/contracts/delivery";

export type DirectScriptCockpitEvidence = {
  intent: AuthorIntentCurrent;
  sources: EpisodeDevelopmentCatalog;
  episodes: EpisodeDevelopmentResult[];
  workflows: CreationWorkflow[];
  packages: PilotPackageRecord[];
};
type EvidenceClient = Pick<
  StudioClient,
  "authorIntents" | "episodeDevelopments" | "creation" | "pilotPackages"
>;

async function allPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
  belongs: (item: T) => boolean,
): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      if (!belongs(item)) throw new Error("直写正式资料归属不一致，尚未核验。");
      if (ids.has(item.id))
        throw new Error("直写正式资料分页对象重复，不能显示为已核验。");
      ids.add(item.id);
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor))
      throw new Error("直写正式资料分页游标重复，不能把不完整读取显示为完成。");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

// Domain-owned read-only SDKs. No invented novel/diagnosis/season chain,
// business writes, extra SSE connections, or media/model calls.
export async function loadDirectScriptCockpitEvidence(
  client: EvidenceClient,
  projectId: string,
): Promise<DirectScriptCockpitEvidence> {
  const [intent, sources, episodes, workflows, packages] = await Promise.all([
    client.authorIntents.current(projectId),
    client.episodeDevelopments.sources(projectId),
    allPages(
      (cursor) => client.episodeDevelopments.list(projectId, cursor, 100),
      (item) => item.projectId === projectId,
    ),
    allPages(
      (cursor) => client.creation.list(projectId, undefined, cursor),
      (item) => item.input.projectId === projectId,
    ),
    allPages(
      (cursor) => client.pilotPackages.list(projectId, cursor, 100),
      (item) => item.manifest.projectId === projectId,
    ),
  ]);
  if (
    sources.projectId !== projectId ||
    (sources.direct && sources.direct.project.id !== projectId) ||
    sources.currentResults.some((item) => item.projectId !== projectId) ||
    (intent.current && intent.current.projectId !== projectId)
  )
    throw new Error("直写来源或作者意图归属不一致，尚未核验。");
  return { intent, sources, episodes, workflows, packages };
}
