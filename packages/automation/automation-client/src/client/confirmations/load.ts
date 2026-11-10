import { value } from "../creation/remote.ts";
import {
  deriveConfirmations,
  type ConfirmationItem,
  type ConfirmationSources,
} from "./derive.ts";
import {
  MismatchError,
  type ConfirmationRemotes,
  type CreationWorkflow,
  type Project,
  type RevisionSummary,
  type StoryAssertion,
  type StoryDeclaration,
  type Task,
  type Translate,
} from "./remote.ts";

/** What the center could read: the items, and every source it could not. */
export interface ConfirmationEvidence {
  projects: Project[];
  items: ConfirmationItem[];
  /** A source (in the author's words) that failed, and its project. */
  unavailable: { source: string; projectId: string | undefined }[];
}

type Page<T> = { items: T[]; nextCursor?: string | undefined };

/**
 * Every page of a paged read; a cursor seen twice fails the whole read.
 * @param readPage - one page from a cursor.
 */
async function pages<T>(
  readPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new MismatchError("mismatch.pagesUnfinished");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

/**
 * Every page of a project's records, each checked as a whole: the page and
 * every record belong to the project, the cursor is the last record, no
 * record repeats (even with another version) and each passes `valid`. A
 * failure rejects the whole source rather than keeping its earlier pages.
 * @param projectId - the project read.
 * @param readPage - one page from a cursor.
 * @param valid - the check of one record.
 * @param projectOf - the project a record belongs to.
 */
async function checkedPages<T extends { id: string }>(
  projectId: string,
  readPage: (
    cursor: string | undefined,
  ) => Promise<Page<T> & { projectId?: string | undefined }>,
  valid: (item: T) => boolean,
  projectOf: (item: T) => string,
  pageProject = true,
): Promise<T[]> {
  const identities = new Set<string>();
  return pages(async (cursor) => {
    const page = await readPage(cursor);
    if (
      (pageProject && page.projectId !== projectId) ||
      (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id) ||
      page.items.some((item) => {
        if (
          projectOf(item) !== projectId ||
          identities.has(item.id) ||
          !valid(item)
        )
          return true;
        identities.add(item.id);
        return false;
      })
    )
      throw new MismatchError("mismatch.pagesOwner");
    return page;
  });
}

const query = (cursor: string | undefined, limit?: number) => ({
  ...(cursor ? { cursor } : {}),
  ...(limit !== undefined ? { limit } : {}),
});

/** Projects scanned at once, so a large library is bounded, not truncated. */
const PARALLEL = 3;

/**
 * Read every record waiting for the author from the domains that own
 * them, one project at a time (three at once), and derive the center's
 * items. A source that fails is named in `unavailable`, never shown as
 * empty.
 * @param remotes - the owning domains' Remote namespaces.
 * @param projectId - the one project to read, or all of them.
 * @param t - the confirmation copy.
 */
export async function loadConfirmations(
  remotes: ConfirmationRemotes,
  projectId: string | undefined,
  t: Translate,
): Promise<ConfirmationEvidence> {
  const projects = await value<Project[]>(remotes.workspace.projectsList());
  if (projectId && !projects.some((project) => project.id === projectId))
    throw new MismatchError("mismatch.projectGone");
  const selected = projectId
    ? projects.filter((project) => project.id === projectId)
    : projects;
  const unavailable: ConfirmationEvidence["unavailable"] = [];
  async function read<T>(
    source: Parameters<Translate>[0],
    id: string | undefined,
    readSource: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await readSource();
    } catch {
      unavailable.push({ source: t(source), projectId: id });
      return [];
    }
  }
  const { automation, delivery, knowledge, media, production, quality } =
    remotes;
  // The task list holds every task, acknowledged failures among them.
  const tasks = await read("source.tasks", projectId, () =>
    value<Task[]>(automation.tasksList()),
  );
  const found: Omit<ConfirmationSources, "projects" | "tasks"> = {
    workflows: [],
    storyBible: [],
    imports: [],
    manuscripts: [],
    providerActions: [],
    pilotPackages: [],
    revisions: [],
    authorIntents: [],
    diagnoses: [],
    seasonPlans: [],
    adaptationStrategies: [],
    narrativeReports: [],
    localReviews: [],
    scriptRevisions: [],
    topologyRevisions: [],
    sourceRevisions: [],
    narrativeSummaries: [],
    episodeResults: [],
    mediaSourceReviews: [],
    audioRevisions: [],
    audioResolutions: [],
    storyDeclarations: [],
    storyAssertions: [],
  };
  const push = <K extends keyof typeof found>(
    key: K,
    items: (typeof found)[K],
  ) => {
    (found[key] as unknown[]).push(...items);
  };
  const scan = async (id: string) => {
    const own = <T>(items: T[], projectOf: (item: T) => string) =>
      items.filter((item) => projectOf(item) === id);
    const [runs, changes, extractions, records, revisions, intents] =
      await Promise.all([
        read("source.runs", id, () =>
          pages((cursor) =>
            value<Page<CreationWorkflow>>(
              automation.creationList({ projectId: id, ...query(cursor) }),
            ),
          ),
        ),
        read("source.storyBible", id, () =>
          value<(typeof found)["storyBible"][number][]>(
            knowledge.storyBibleList(id),
          ),
        ),
        read("source.imports", id, () =>
          value<(typeof found)["imports"][number][]>(
            remotes.workspace.importExtractionsList(id),
          ),
        ),
        read("source.manuscripts", id, () =>
          pages((cursor) =>
            value<Page<(typeof found)["manuscripts"][number]>>(
              delivery.manuscriptsList(id, query(cursor)),
            ),
          ),
        ),
        read("source.revisions", id, () =>
          pages((cursor) =>
            value<Page<Omit<RevisionSummary, "projectId">>>(
              automation.revisionsList(id, query(cursor)),
            ),
          ),
        ),
        read("source.intents", id, () =>
          pages((cursor) =>
            value<Page<(typeof found)["authorIntents"][number]>>(
              remotes.workspace.authorIntentsList(id, query(cursor)),
            ),
          ),
        ),
      ]);
    const projectRuns = own(runs, (run) => run.input.projectId);
    push("workflows", projectRuns);
    push(
      "providerActions",
      await read("source.providerActions", id, () =>
        checkedPages(
          id,
          (cursor) =>
            value(
              automation.providerActionPreviewsSummaries(
                id,
                query(cursor, 100),
              ),
            ),
          // A summary never carries the call's parameters.
          (item) => !("parameters" in item),
          (item) => item.projectId,
        ),
      ),
    );
    push(
      "pilotPackages",
      await read("source.pilotPackages", id, () =>
        checkedPages(
          id,
          (cursor) => value(delivery.pilotPackagesList(id, query(cursor, 100))),
          () => true,
          (item) => item.manifest.projectId,
          false,
        ),
      ),
    );
    // These are independent author candidates, not model-run projections.
    // Only list metadata is read; the frozen detail never is.
    const [nodes, assertions] = await Promise.all([
      read("source.storyDeclarations", id, () =>
        checkedPages(
          id,
          (cursor) =>
            value<Page<StoryDeclaration>>(
              knowledge.storyDeclarationsList(id, query(cursor, 100)),
            ),
          (item) => (item.status === "adopted") === Boolean(item.adoptedNode),
          (item) => item.projectId,
        ),
      ),
      read("source.storyAssertions", id, () =>
        checkedPages(
          id,
          (cursor) =>
            value<Page<StoryAssertion>>(
              knowledge.storyAssertionsList(id, query(cursor, 100)),
            ),
          (item) =>
            (item.status === "adopted") === Boolean(item.adoptedRecord) &&
            (!item.adoptedRecord ||
              item.adoptedRecord.kind ===
                (item.kind === "relationship" ? "edge" : "cognition")),
          (item) => item.projectId,
        ),
      ),
    ]);
    push("storyDeclarations", nodes);
    push("storyAssertions", assertions);
    // Owner projections are read for every project, even one with no model
    // runs: adopted summaries and human formal scripts must not disappear.
    const [summaries, episodes] = await Promise.all([
      read("source.summaries", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["narrativeSummaries"][number]>>(
            knowledge.narrativeSummariesSummaries(id, query(cursor, 100)),
          ),
        ),
      ),
      read("source.episodes", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["episodeResults"][number]>>(
            production.episodeDevelopmentsSummaries(id, query(cursor, 100)),
          ),
        ),
      ),
    ]);
    push(
      "narrativeSummaries",
      own(summaries, (item) => item.projectId),
    );
    push(
      "episodeResults",
      own(episodes, (item) => item.projectId),
    );
    const [sources, audio, timeline] = await Promise.all([
      read("source.media", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["mediaSourceReviews"][number]>>(
            media.sourcesSummaries(id, query(cursor, 100)),
          ),
        ),
      ),
      read("source.audioRevisions", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["audioRevisions"][number]>>(
            media.audioRevisionsSummaries(id, query(cursor, 100)),
          ),
        ),
      ),
      read("source.audioResolutions", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["audioResolutions"][number]>>(
            remotes.timeline.audioResolutionsSummaries(id, query(cursor, 100)),
          ),
        ),
      ),
    ]);
    push(
      "mediaSourceReviews",
      own(sources, (item) => item.projectId),
    );
    push(
      "audioRevisions",
      own(audio, (item) => item.projectId),
    );
    push(
      "audioResolutions",
      own(timeline, (item) => item.projectId),
    );
    push(
      "sourceRevisions",
      await read("source.sourceRevisions", id, () =>
        checkedPages(
          id,
          (cursor) =>
            value(
              production.episodeDevelopmentsSourceRevisionSummaries(
                id,
                query(cursor),
              ),
            ),
          () => true,
          (item) => item.projectId,
          false,
        ),
      ),
    );
    const topology = await read("source.topology", id, () =>
      pages((cursor) =>
        value<Page<(typeof found)["topologyRevisions"][number]>>(
          production.episodeDevelopmentsTopologyRevisionSummaries(
            id,
            query(cursor),
          ),
        ),
      ),
    );
    push(
      "topologyRevisions",
      own(topology, (item) => item.projectId),
    );
    const scripts = await read("source.scripts", id, () =>
      pages((cursor) =>
        value<Page<(typeof found)["scriptRevisions"][number]>>(
          production.episodeDevelopmentsScriptRevisionSummaries(
            id,
            query(cursor),
          ),
        ),
      ),
    );
    push(
      "scriptRevisions",
      own(scripts, (item) => item.projectId),
    );
    const reports = await read("source.reports", id, () =>
      pages((cursor) =>
        value<Page<(typeof found)["narrativeReports"][number]>>(
          quality.narrativeQualitySummaries(id, {
            ...(cursor ? { cursor } : {}),
            limit: "100",
          }),
        ),
      ),
    );
    push(
      "narrativeReports",
      own(reports, (item) => item.projectId),
    );
    push(
      "localReviews",
      await read("source.localReviews", id, () =>
        checkedPages(
          id,
          (cursor) =>
            value(
              quality.narrativeLocalQualitySummaries(id, query(cursor, 100)),
            ),
          () => true,
          (item) => item.projectId,
        ),
      ),
    );
    const ran = (operation: CreationWorkflow["input"]["operation"]) =>
      projectRuns.some((run) => run.input.operation === operation);
    if (ran("adaptation-diagnosis")) {
      const items = await read("source.diagnoses", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["diagnoses"][number]>>(
            production.diagnosesSummaries(id, query(cursor)),
          ),
        ),
      );
      push(
        "diagnoses",
        own(items, (item) => item.projectId),
      );
    }
    if (ran("adaptation-strategy")) {
      const items = await read("source.strategies", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["adaptationStrategies"][number]>>(
            production.adaptationStrategiesSummaries(id, query(cursor)),
          ),
        ),
      );
      push(
        "adaptationStrategies",
        own(items, (item) => item.projectId),
      );
    }
    push(
      "storyBible",
      own(changes, (change) => change.projectId),
    );
    if (ran("season-plan")) {
      const items = await read("source.seasonPlans", id, () =>
        pages((cursor) =>
          value<Page<(typeof found)["seasonPlans"][number]>>(
            production.seasonPlansSummaries(id, query(cursor)),
          ),
        ),
      );
      push(
        "seasonPlans",
        own(items, (item) => item.projectId),
      );
    }
    push(
      "imports",
      own(extractions, (change) => change.projectId),
    );
    push(
      "manuscripts",
      own(records, (record) => record.manifest.projectId),
    );
    push(
      "revisions",
      revisions.map((preview) => ({ ...preview, projectId: id })),
    );
    push(
      "authorIntents",
      own(intents, (intent) => intent.projectId),
    );
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, selected.length) }, async () => {
      while (next < selected.length) await scan(selected[next++]!.id);
    }),
  );
  return {
    projects,
    unavailable,
    items: deriveConfirmations(
      {
        ...found,
        projects,
        tasks: tasks.filter(
          (task) => !projectId || task.projectId === projectId,
        ),
      },
      t,
    ),
  };
}
