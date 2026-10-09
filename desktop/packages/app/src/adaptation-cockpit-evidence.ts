import type { StudioClient } from "@dramaip/client";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { AuthorIntentCurrent } from "@dramaip/contracts/workspace";
import type {
  AdaptationDiagnosis,
  DiagnosisCatalog,
  SeasonPlan,
  EpisodeDevelopmentResult,
  AdaptationStrategy,
} from "@dramaip/contracts/production";
import type { PilotPackageRecord } from "@dramaip/contracts/delivery";

export type AdaptationCockpitEvidence = {
  intent: AuthorIntentCurrent;
  sources: DiagnosisCatalog;
  diagnoses: AdaptationDiagnosis[];
  plans: SeasonPlan[];
  strategies?: AdaptationStrategy[];
  episodes: EpisodeDevelopmentResult[];
  workflows: CreationWorkflow[];
  packages: PilotPackageRecord[];
};

type EvidenceClient = Pick<
  StudioClient,
  | "authorIntents"
  | "diagnoses"
  | "seasonPlans"
  | "episodeDevelopments"
  | "creation"
  | "pilotPackages"
> &
  Partial<Pick<StudioClient, "adaptationStrategies">>;

async function allPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
  belongs: (item: T) => boolean,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (page.items.some((item) => !belongs(item)))
      throw new Error("改编阶段资料归属不一致，不能显示为已核验。");
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("改编阶段分页游标重复，不能把不完整资料显示为完成。");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

// Read through domain-owned SDKs only. No count-based completion, writes,
// extra SSE connection, automatic adoption, or media/provider invocation.
export async function loadAdaptationCockpitEvidence(
  client: EvidenceClient,
  projectId: string,
): Promise<AdaptationCockpitEvidence> {
  const [intent, sources, diagnoses, plans, episodes, workflows, packages] =
    await Promise.all([
      client.authorIntents.current(projectId),
      client.diagnoses.sources(projectId),
      allPages(
        (cursor) => client.diagnoses.list(projectId, cursor, 100),
        (item) => item.projectId === projectId,
      ),
      allPages(
        (cursor) => client.seasonPlans.list(projectId, cursor, 100),
        (item) => item.projectId === projectId,
      ),
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
    (intent.current && intent.current.projectId !== projectId)
  )
    throw new Error("改编来源或作者意图归属不一致，尚未核验。");
  const strategies = client.adaptationStrategies
    ? await allPages(
        (cursor) => client.adaptationStrategies!.list(projectId, cursor, 100),
        (item) => item.projectId === projectId,
      )
    : [];
  return {
    intent,
    sources,
    diagnoses,
    plans,
    strategies,
    episodes,
    workflows,
    packages,
  };
}
