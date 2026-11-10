import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation/remote";
import type {} from "@dramaip/production-delivery/remote";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import type {} from "@dramaip/writing-knowledge/remote";
import type {} from "@dramaip/writing-writing/remote";
import { value } from "../tools/remote.ts";
import type {
  AdaptationDiagnosis,
  AdaptationStrategy,
  AuthorIntentCurrent,
  ChapterAdoption,
  CreationWorkflow,
  DiagnosisCatalog,
  DomainEntity,
  EpisodeDevelopmentCatalog,
  EpisodeDevelopmentResult,
  ManuscriptRecord,
  PilotPackageRecord,
  SeasonPlan,
} from "./types.ts";

/** The Remote namespaces the cockpit evidence is read from. */
export interface EvidenceRemotes {
  workspace: Context["remote"]["workspace"];
  writing: Context["remote"]["writing"];
  knowledge: Context["remote"]["knowledge"];
  automation: Context["remote"]["automation"];
  production: Context["remote"]["production"];
  delivery: Context["remote"]["delivery"];
}

/** What a novel project's cockpit verifies. */
export type NovelCockpitEvidence = {
  adoptions: ChapterAdoption[];
  workflows: CreationWorkflow[];
  memories: DomainEntity[];
  manuscripts?: ManuscriptRecord[];
};

/** What an adaptation project's cockpit verifies. */
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

/** What a direct script project's cockpit verifies. */
export type DirectScriptCockpitEvidence = {
  intent: AuthorIntentCurrent;
  sources: EpisodeDevelopmentCatalog;
  episodes: EpisodeDevelopmentResult[];
  workflows: CreationWorkflow[];
  packages: PilotPackageRecord[];
};

/** One page of a cursor-paged list. */
type Page<T> = { items: T[]; nextCursor?: string };

/** The copy of the refusals the paged reads raise. */
interface PagedCopy {
  /** An item belongs to another project. */
  foreign?: string;
  /** An item id repeats across pages. */
  repeated?: string;
  /** A cursor repeats. */
  cursor: string;
}

/**
 * Read every page of a list, refusing an item of another project, a
 * repeated item and a repeated cursor, so an incomplete read is never shown
 * as verified.
 */
async function allPages<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  copy: PagedCopy,
  belongs: (item: T) => boolean = () => true,
): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      if (!belongs(item)) throw new Error(copy.foreign);
      const id = (item as { id?: unknown }).id;
      if (copy.repeated && typeof id === "string") {
        if (ids.has(id)) throw new Error(copy.repeated);
        ids.add(id);
      }
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error(copy.cursor);
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

const query = (cursor: string | undefined) =>
  cursor === undefined ? { limit: 100 } : { cursor, limit: 100 };

/** The creation workflows of one project, every page. */
const workflowsOf = (
  remotes: EvidenceRemotes,
  projectId: string,
  copy: PagedCopy,
) =>
  allPages(
    (cursor) =>
      value(
        remotes.automation.creationList(
          cursor === undefined ? { projectId } : { projectId, cursor },
        ),
      ),
    copy,
    (item) => item.input.projectId === projectId,
  );

/** The pilot packages of one project, every page. */
const packagesOf = (
  remotes: EvidenceRemotes,
  projectId: string,
  copy: PagedCopy,
) =>
  allPages(
    (cursor) =>
      value(remotes.delivery.pilotPackagesList(projectId, query(cursor))),
    copy,
    (item) => item.manifest.projectId === projectId,
  );

/** Read a novel project's adoptions, workflows, memories and manuscripts. */
export async function loadNovelCockpitEvidence(
  remotes: EvidenceRemotes,
  projectId: string,
): Promise<NovelCockpitEvidence> {
  const copy = {
    cursor: "项目状态分页游标重复，不能把不完整资料标为已核验。",
  };
  const records = { projectId };
  const [adoptions, workflows, memories, manuscripts] = await Promise.all([
    allPages(
      (cursor) =>
        value(remotes.writing.chaptersAdoptions(projectId, query(cursor))),
      copy,
    ),
    workflowsOf(remotes, projectId, copy),
    Promise.all([
      value(remotes.knowledge.chapterMemoriesList(records)),
      value(remotes.knowledge.characterStatesList(records)),
      value(remotes.knowledge.storyEventsList(records)),
      value(remotes.knowledge.foreshadowingsList(records)),
    ]),
    allPages(
      (cursor) =>
        value(remotes.delivery.manuscriptsList(projectId, query(cursor))),
      copy,
    ),
  ]);
  return {
    adoptions,
    workflows,
    memories: memories.flat() as DomainEntity[],
    manuscripts,
  };
}

/**
 * Read an adaptation project's author intent, sources, diagnoses, season
 * plans, strategies, episodes, workflows and pilot packages.
 */
export async function loadAdaptationCockpitEvidence(
  remotes: EvidenceRemotes,
  projectId: string,
): Promise<AdaptationCockpitEvidence> {
  const copy = {
    foreign: "改编阶段资料归属不一致，不能显示为已核验。",
    cursor: "改编阶段分页游标重复，不能把不完整资料显示为完成。",
  };
  const own = (item: { projectId: string }) => item.projectId === projectId;
  const { production } = remotes;
  const [
    intent,
    sources,
    diagnoses,
    plans,
    strategies,
    episodes,
    workflows,
    packages,
  ] = await Promise.all([
    value(remotes.workspace.authorIntentsCurrent(projectId)),
    value(production.diagnosesSources(projectId)),
    allPages(
      (cursor) => value(production.diagnosesList(projectId, query(cursor))),
      copy,
      own,
    ),
    allPages(
      (cursor) => value(production.seasonPlansList(projectId, query(cursor))),
      copy,
      own,
    ),
    allPages(
      (cursor) =>
        value(production.adaptationStrategiesList(projectId, query(cursor))),
      copy,
      own,
    ),
    allPages(
      (cursor) =>
        value(production.episodeDevelopmentsList(projectId, query(cursor))),
      copy,
      own,
    ),
    workflowsOf(remotes, projectId, copy),
    packagesOf(remotes, projectId, copy),
  ]);
  if (
    sources.projectId !== projectId ||
    (intent.current && intent.current.projectId !== projectId)
  )
    throw new Error("改编来源或作者意图归属不一致，尚未核验。");
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

/**
 * Read a direct script project's author intent, sources, episodes,
 * workflows and pilot packages.
 */
export async function loadDirectScriptCockpitEvidence(
  remotes: EvidenceRemotes,
  projectId: string,
): Promise<DirectScriptCockpitEvidence> {
  const copy = {
    foreign: "直写正式资料归属不一致，尚未核验。",
    repeated: "直写正式资料分页对象重复，不能显示为已核验。",
    cursor: "直写正式资料分页游标重复，不能把不完整读取显示为完成。",
  };
  const { production } = remotes;
  const [intent, sources, episodes, workflows, packages] = await Promise.all([
    value(remotes.workspace.authorIntentsCurrent(projectId)),
    value(production.episodeDevelopmentsSources(projectId)),
    allPages(
      (cursor) =>
        value(production.episodeDevelopmentsList(projectId, query(cursor))),
      copy,
      (item) => item.projectId === projectId,
    ),
    workflowsOf(remotes, projectId, copy),
    packagesOf(remotes, projectId, copy),
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
