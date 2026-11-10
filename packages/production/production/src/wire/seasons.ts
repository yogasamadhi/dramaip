/**
 * The shapes the season operations declare.
 *
 * @module @dramaip/production-production/wire/seasons
 */

/** Input of `production/seasonsCreate` (`seasons.create`). */
export type SeasonsCreateInput = {
  adaptationId?: string;
  title: string;
  outline?: string;
  sourceChapterVersion?: string;
};

/** Answer of `production/seasonsCreate` (`seasons.create`). */
export type SeasonsCreateResult = {
  id: string;
  projectId: string;
  adaptationId?: string;
  title: string;
  outline: string;
  sourceChapterVersion?: string;
  status: "draft" | "ready" | "review_required" | "archived";
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `production/seasonsList` (`seasons.list`). */
export type SeasonsListQuery = {
  cursor?: string;
  limit?: string;
};

/** Answer of `production/seasonsList` (`seasons.list`). */
export type SeasonsListResult = {
  items: {
    id: string;
    projectId: string;
    adaptationId?: string;
    title: string;
    outline: string;
    sourceChapterVersion?: string;
    status: "draft" | "ready" | "review_required" | "archived";
    orderIndex: number;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `production/seasonsMapChapter` (`seasons.mapChapter`). */
export type SeasonsMapChapterInput = {
  chapterId: string;
  chapterVersion: number;
};

/** Answer of `production/seasonsMapChapter` (`seasons.mapChapter`). */
export type SeasonsMapChapterResult = {
  seasonId: string;
  chapterId: string;
  chapterVersion: number;
  id: string;
  createdAt: string;
};

/** Input of `production/seasonsUpdate` (`seasons.update`). */
export type SeasonsUpdateInput = {
  title?: string;
  outline?: string;
  status?: "draft" | "ready" | "review_required" | "archived";
  version: number;
};

/** Answer of `production/seasonsUpdate` (`seasons.update`). */
export type SeasonsUpdateResult = {
  id: string;
  projectId: string;
  adaptationId?: string;
  title: string;
  outline: string;
  sourceChapterVersion?: string;
  status: "draft" | "ready" | "review_required" | "archived";
  orderIndex: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
