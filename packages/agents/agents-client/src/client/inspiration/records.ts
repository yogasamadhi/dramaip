/**
 * The inspiration space's records as the `agents`, `knowledge` and `quality`
 * Remote namespaces answer them, and the Remote calls that read them.
 */
import type { Context } from "@deepseek-ai/cordis";
import type {
  CreativeCollectionsListResult,
  CreativeCorpusListResult,
} from "@dramaip/writing-knowledge/types";
import type {
  CreativeExperimentsListResult,
  CreativeFingerprintGetResult,
} from "@dramaip/writing-quality/types";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/writing-knowledge/remote";
import type {} from "@dramaip/writing-quality/remote";
import { value, type AgentsRemote } from "../ai-settings.ts";
import type { SystemRemote } from "../events.ts";

/** The Remote namespaces the inspiration space reads and writes. */
export interface InspirationRemotes {
  agents: AgentsRemote;
  knowledge: Context["remote"]["knowledge"];
  quality: Context["remote"]["quality"];
  system: SystemRemote;
}

/** The creative modes a conversation runs in, in tab order. */
export const MODES = [
  "free",
  "guided",
  "character_interview",
  "world_simulation",
  "conflict_lab",
] as const;

/** A creative mode. */
export type CreativeMode = (typeof MODES)[number];

/**
 * The mode a conversation names; an unknown one reads as free roam.
 * @param mode - the stored mode.
 */
export function creativeMode(mode: string | undefined): CreativeMode {
  return MODES.find((entry) => entry === mode) ?? "free";
}

/** The kinds of inspiration card, in the order the author picks from. */
export const CARD_KINDS = [
  "premise",
  "character",
  "world",
  "conflict",
  "scene",
  "style",
  "question",
] as const;

/** An inspiration conversation in the list. */
export interface ConversationSummary {
  id: string;
  title?: string | undefined;
  creativeMode?: string | undefined;
}

/** One inspiration card of a conversation. */
export interface InspirationCard {
  id: string;
  kind: string;
  title: string;
  content: string;
  adopted: boolean;
  version: number;
}

/** One long-term creative memory. */
export interface CreativeMemory {
  id: string;
  kind: string;
  content: string;
  confidence: number;
  status: "active" | "disabled";
  version: number;
}

/** Whether the space may learn across conversations. */
export interface MemorySettings {
  enabled: boolean;
  consentedAt?: string | undefined;
}

/** One background memory consolidation of a conversation. */
export interface MemoryJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  error?: string | undefined;
  model?: string | undefined;
  usageRuns?:
    readonly { runId: string; projectId?: string | undefined }[] | undefined;
}

/** An agent engine the space can start a conversation on. */
export interface SpaceEngine {
  kind: string;
  isDefault?: boolean | undefined;
  canRun?: boolean | undefined;
}

/** One corpus entry. */
export type CorpusItem = CreativeCorpusListResult["items"][number];
/** One entry of the private collection. */
export type CollectionItem = CreativeCollectionsListResult["items"][number];
/** The creative fingerprint. */
export type Fingerprint = CreativeFingerprintGetResult;
/** One creative experiment and its three routes. */
export type Experiment = CreativeExperimentsListResult["items"][number];

/** Everything the side panels show. */
export interface Outcomes {
  settings: MemorySettings;
  memories: CreativeMemory[];
  cards: InspirationCard[];
  jobs: MemoryJob[];
  corpus: CorpusItem[];
  collections: CollectionItem[];
  fingerprint: Fingerprint;
  experiments: Experiment[];
}

/**
 * Search the corpus, fifty entries at most.
 * @param remotes - the Remote namespaces.
 * @param query - the search words.
 */
export async function searchCorpus(
  { knowledge }: InspirationRemotes,
  query: string,
): Promise<CorpusItem[]> {
  return (
    await value<CreativeCorpusListResult>(
      knowledge.creativeCorpusList({ query, limit: "50" }),
    )
  ).items;
}

/**
 * Read the side panels at once: memory settings, memories, the corpus and
 * collection, the fingerprint and experiments, and, for a conversation, its
 * cards and memory jobs.
 * @param remotes - the Remote namespaces.
 * @param conversationId - the open conversation, if any.
 * @param query - the corpus search words.
 */
export async function readOutcomes(
  remotes: InspirationRemotes,
  conversationId: string | undefined,
  query: string,
): Promise<Outcomes> {
  const { agents, knowledge, quality } = remotes;
  const [
    settings,
    memories,
    cards,
    jobs,
    corpus,
    collections,
    fingerprint,
    experiments,
  ] = await Promise.all([
    value<MemorySettings>(agents.inspirationMemorySettingsGet()),
    value<CreativeMemory[]>(agents.inspirationMemoriesList()),
    conversationId
      ? value<InspirationCard[]>(
          agents.inspirationCardsList({ conversationId }),
        )
      : Promise.resolve([]),
    conversationId
      ? value<MemoryJob[]>(agents.inspirationMemoryJobsList({ conversationId }))
      : Promise.resolve([]),
    searchCorpus(remotes, query),
    value<CreativeCollectionsListResult>(
      knowledge.creativeCollectionsList(),
    ).then((answer) => answer.items),
    value<Fingerprint>(quality.creativeFingerprintGet()),
    value<CreativeExperimentsListResult>(
      quality.creativeExperimentsList(undefined),
    ).then((answer) => answer.items),
  ]);
  return {
    settings,
    memories,
    cards,
    jobs,
    corpus,
    collections,
    fingerprint,
    experiments,
  };
}
