/**
 * The records the narrative context picker reads, typed by the Remote
 * methods that answer them.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { CreationStartInput } from "@dramaip/automation-automation/types";
import type {
  NarrativeIndexChapterResult,
  NarrativeStoryIndexCatalogResult,
  NarrativeSummariesGetResult,
  NarrativeSummariesScopesResult,
} from "@dramaip/writing-knowledge/types";
import type {} from "@dramaip/writing-knowledge/remote";
import type { ChaptersListResult } from "@dramaip/writing-writing/types";

/** The `knowledge` Remote namespace the picker reads. */
export type KnowledgeRemote = Context["remote"]["knowledge"];

export type Chapter = ChaptersListResult[number];
export type NarrativeContextRequest = NonNullable<
  CreationStartInput["narrativeContextRequest"]
>;
export type ContextChapterSelection =
  NarrativeContextRequest["chapters"][number];
export type NarrativeStorySelection = NonNullable<
  NarrativeContextRequest["story"]
>[number];
export type NarrativeIndexDetail = NarrativeIndexChapterResult;
export type NarrativeSummary = NarrativeSummariesGetResult;
export type NarrativeSummaryScopes = NarrativeSummariesScopesResult;
export type NarrativeStoryIndex = NarrativeStoryIndexCatalogResult;
export type NarrativeStoryIndexEntry = NarrativeStoryIndex["entries"][number];
export type NarrativeStoryHierarchy = NarrativeStoryIndex["hierarchy"];
