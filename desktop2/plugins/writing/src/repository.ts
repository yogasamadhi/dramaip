import { randomUUID } from "node:crypto";

import { ApiProblem } from "@dramaip/http";
import type {
  ProjectArchiveContributor,
  SourceImportAdopter,
  UnitOfWork,
  UnitOfWorkTransaction,
  WorkspaceProjectContract,
} from "@dramaip/plugin-api";

import type {
  Chapter,
  ChapterVersion,
  CreateChapter,
  Revision,
  UpdateChapter,
  WritingWorkspace,
} from "./contracts.ts";

interface ChapterRow {
  row_cursor: number;
  id: string;
  project_id: string;
  title: string;
  summary: string;
  content: string;
  outline: string;
  main_conflict: string;
  hook: string;
  highlight: string;
  reversal: string;
  cliffhanger: string;
  short_drama_note: string;
  ai_video_note: string;
  status: Chapter["status"];
  ordinal: number;
  word_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  row_cursor: number;
  id: string;
  chapter_id: string;
  chapter_version: number;
  title: string;
  content: string;
  fields_json: string;
  reason: ChapterVersion["reason"];
  created_at: string;
}

interface RevisionRow {
  id: string;
  project_id: string;
  chapter_id: string;
  base_version: number;
  proposed_title: string;
  proposed_content: string;
  rationale: string;
  status: Revision["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

const chapterColumns = `rowid AS row_cursor, id, project_id, title, summary, content,
  outline, main_conflict, hook, highlight, reversal, cliffhanger,
  short_drama_note, ai_video_note, status, ordinal, word_count,
  version, created_at, updated_at`;

const wordCount = (value: string) => [...value.replace(/\s/gu, "")].length;
const toChapter = (row: ChapterRow): Chapter => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  summary: row.summary,
  content: row.content,
  outline: row.outline,
  mainConflict: row.main_conflict,
  hook: row.hook,
  highlight: row.highlight,
  reversal: row.reversal,
  cliffhanger: row.cliffhanger,
  shortDramaNote: row.short_drama_note,
  aiVideoNote: row.ai_video_note,
  status: row.status,
  ordinal: row.ordinal,
  wordCount: row.word_count,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toVersion = (row: VersionRow): ChapterVersion => ({
  id: row.id,
  chapterId: row.chapter_id,
  chapterVersion: row.chapter_version,
  title: row.title,
  content: row.content,
  fields: JSON.parse(row.fields_json) as Record<string, string>,
  reason: row.reason,
  createdAt: row.created_at,
});
const toRevision = (row: RevisionRow): Revision => ({
  id: row.id,
  projectId: row.project_id,
  chapterId: row.chapter_id,
  baseVersion: row.base_version,
  proposedTitle: row.proposed_title,
  proposedContent: row.proposed_content,
  rationale: row.rationale,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class WritingRepository {
  constructor(readonly uow: UnitOfWork) {}

  workspace(projectId: string): WritingWorkspace {
    return this.uow.execute((tx) => {
      this.ensureWorkspace(tx, projectId);
      const state = tx.get<{
        version: number;
        word_goal: number;
        updated_at: string;
      }>(
        "SELECT version, word_goal, updated_at FROM writing_workspaces WHERE project_id = ?",
        projectId,
      )!;
      const chapters = tx
        .all<ChapterRow>(
          `SELECT ${chapterColumns} FROM writing_chapters WHERE project_id = ? ORDER BY ordinal, created_at`,
          projectId,
        )
        .map(toChapter);
      return {
        projectId,
        version: state.version,
        wordGoal: state.word_goal,
        totalWordCount: chapters.reduce(
          (sum, chapter) => sum + chapter.wordCount,
          0,
        ),
        chapters,
        updatedAt: state.updated_at,
      };
    });
  }

  listChapters(projectId: string, cursor?: string, limit = 200) {
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
    const rows = this.uow.execute((tx) =>
      tx.all<ChapterRow>(
        `SELECT ${chapterColumns} FROM writing_chapters
       WHERE project_id = ? AND rowid > ? ORDER BY ordinal, rowid LIMIT ?`,
        projectId,
        offset,
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(toChapter),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  getChapter(id: string): Chapter {
    return this.uow.execute((tx) => toChapter(this.chapterRow(tx, id)));
  }

  createChapter(
    input: CreateChapter,
    reason: ChapterVersion["reason"] = "manual-save",
  ) {
    return this.uow.execute((tx) => this.insertChapter(tx, input, reason));
  }

  insertChapter(
    tx: UnitOfWorkTransaction,
    input: CreateChapter,
    reason: ChapterVersion["reason"],
    id: string = randomUUID(),
  ): Chapter {
    this.ensureWorkspace(tx, input.projectId);
    const now = new Date().toISOString();
    const ordinal =
      input.ordinal ??
      tx.get<{ value: number }>(
        "SELECT COALESCE(MAX(ordinal), -1) + 1 AS value FROM writing_chapters WHERE project_id = ?",
        input.projectId,
      )?.value ??
      0;
    const chapter: Chapter = {
      id,
      projectId: input.projectId,
      title: input.title,
      summary: input.summary,
      content: input.content,
      outline: input.outline,
      mainConflict: input.mainConflict,
      hook: input.hook,
      highlight: input.highlight,
      reversal: input.reversal,
      cliffhanger: input.cliffhanger,
      shortDramaNote: input.shortDramaNote,
      aiVideoNote: input.aiVideoNote,
      status: input.status,
      ordinal,
      wordCount: wordCount(input.content),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    tx.run(
      `INSERT INTO writing_chapters
       (id, project_id, title, summary, content, outline, main_conflict, hook,
        highlight, reversal, cliffhanger, short_drama_note, ai_video_note,
        status, ordinal, word_count, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      chapter.id,
      chapter.projectId,
      chapter.title,
      chapter.summary,
      chapter.content,
      chapter.outline,
      chapter.mainConflict,
      chapter.hook,
      chapter.highlight,
      chapter.reversal,
      chapter.cliffhanger,
      chapter.shortDramaNote,
      chapter.aiVideoNote,
      chapter.status,
      chapter.ordinal,
      chapter.wordCount,
      now,
      now,
    );
    this.snapshot(tx, chapter, reason);
    this.bumpWorkspace(tx, input.projectId);
    this.event(tx, "created", chapter);
    return chapter;
  }

  updateChapter(
    id: string,
    expectedVersion: number,
    input: UpdateChapter,
    reason: ChapterVersion["reason"] | null = null,
  ) {
    return this.uow.execute((tx) =>
      this.updateChapterTx(tx, id, expectedVersion, input, reason),
    );
  }

  updateChapterTx(
    tx: UnitOfWorkTransaction,
    id: string,
    expectedVersion: number,
    input: UpdateChapter,
    reason: ChapterVersion["reason"] | null,
  ): Chapter {
    const row = this.chapterRow(tx, id);
    if (row.version !== expectedVersion)
      throw new ApiProblem(412, "VERSION_CONFLICT", "chapter version changed");
    const previous = toChapter(row);
    const chapter: Chapter = {
      ...previous,
      ...input,
      wordCount: wordCount(input.content ?? previous.content),
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    };
    tx.run(
      `UPDATE writing_chapters SET title = ?, summary = ?, content = ?, outline = ?,
       main_conflict = ?, hook = ?, highlight = ?, reversal = ?, cliffhanger = ?,
       short_drama_note = ?, ai_video_note = ?, status = ?, word_count = ?,
       version = ?, updated_at = ? WHERE id = ? AND version = ?`,
      chapter.title,
      chapter.summary,
      chapter.content,
      chapter.outline,
      chapter.mainConflict,
      chapter.hook,
      chapter.highlight,
      chapter.reversal,
      chapter.cliffhanger,
      chapter.shortDramaNote,
      chapter.aiVideoNote,
      chapter.status,
      chapter.wordCount,
      chapter.version,
      chapter.updatedAt,
      id,
      expectedVersion,
    );
    if (reason === "manual-save") {
      this.snapshot(tx, chapter, reason);
    } else if (reason === "agent-commit") {
      this.snapshot(tx, previous, "restore-checkpoint");
      this.snapshot(tx, chapter, reason);
    } else if (reason) {
      this.snapshot(tx, previous, reason);
    }
    this.bumpWorkspace(tx, chapter.projectId);
    this.event(tx, "updated", chapter);
    return chapter;
  }

  removeChapter(id: string, expectedVersion: number): void {
    this.uow.execute((tx) => {
      const row = this.chapterRow(tx, id);
      if (row.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "chapter version changed",
        );
      tx.run(
        "DELETE FROM writing_chapters WHERE id = ? AND version = ?",
        id,
        expectedVersion,
      );
      this.bumpWorkspace(tx, row.project_id);
      tx.append({
        type: "writing.chapter-deleted.v1",
        pluginId: "writing",
        aggregateType: "chapter",
        aggregateId: id,
        aggregateVersion: expectedVersion + 1,
        payload: { id, projectId: row.project_id },
      });
    });
  }

  reorder(
    projectId: string,
    expectedWorkspaceVersion: number,
    ids: readonly string[],
  ): WritingWorkspace {
    this.uow.execute((tx) => {
      this.ensureWorkspace(tx, projectId);
      const state = tx.get<{ version: number }>(
        "SELECT version FROM writing_workspaces WHERE project_id = ?",
        projectId,
      )!;
      if (state.version !== expectedWorkspaceVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "writing workspace version changed",
        );
      const current = tx
        .all<{
          id: string;
        }>(
          "SELECT id FROM writing_chapters WHERE project_id = ? ORDER BY ordinal",
          projectId,
        )
        .map((row) => row.id);
      if (
        current.length !== ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !current.includes(id))
      )
        throw new ApiProblem(
          409,
          "CHAPTER_ORDER_INVALID",
          "chapter order must contain every project chapter once",
        );
      ids.forEach((id, ordinal) =>
        tx.run(
          "UPDATE writing_chapters SET ordinal = ? WHERE id = ? AND project_id = ?",
          ordinal,
          id,
          projectId,
        ),
      );
      this.bumpWorkspace(tx, projectId);
    });
    return this.workspace(projectId);
  }

  versions(chapterId: string, cursor?: string, limit = 50) {
    const offset = cursor
      ? Number.parseInt(cursor, 10)
      : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(offset) || offset < 1)
      throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
    const rows = this.uow.execute((tx) =>
      tx.all<VersionRow>(
        `SELECT rowid AS row_cursor, id, chapter_id, chapter_version, title, content,
       fields_json, reason, created_at FROM writing_chapter_versions
       WHERE chapter_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?`,
        chapterId,
        offset,
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(toVersion),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  restore(
    chapterId: string,
    versionId: string,
    expectedVersion: number,
  ): Chapter {
    return this.uow.execute((tx) => {
      const current = toChapter(this.chapterRow(tx, chapterId));
      if (current.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          "chapter version changed",
        );
      const row = tx.get<VersionRow>(
        `SELECT rowid AS row_cursor, id, chapter_id, chapter_version, title, content,
         fields_json, reason, created_at FROM writing_chapter_versions WHERE id = ? AND chapter_id = ?`,
        versionId,
        chapterId,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "CHAPTER_VERSION_NOT_FOUND",
          "chapter version does not exist",
        );
      const fields = JSON.parse(row.fields_json) as UpdateChapter;
      return this.updateChapterTx(
        tx,
        chapterId,
        expectedVersion,
        { ...fields, title: row.title, content: row.content },
        "restore-checkpoint",
      );
    });
  }

  createRevision(
    input: Omit<
      Revision,
      "id" | "status" | "version" | "createdAt" | "updatedAt"
    >,
  ): Revision {
    const chapter = this.getChapter(input.chapterId);
    if (
      chapter.projectId !== input.projectId ||
      chapter.version !== input.baseVersion
    )
      throw new ApiProblem(412, "VERSION_CONFLICT", "chapter version changed");
    const now = new Date().toISOString();
    const revision: Revision = {
      id: randomUUID(),
      ...input,
      status: "pending",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.uow.execute((tx) =>
      tx.run(
        `INSERT INTO writing_revisions (id, project_id, chapter_id, base_version,
       proposed_title, proposed_content, rationale, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
        revision.id,
        revision.projectId,
        revision.chapterId,
        revision.baseVersion,
        revision.proposedTitle,
        revision.proposedContent,
        revision.rationale,
        now,
        now,
      ),
    );
    return revision;
  }

  getRevision(id: string): Revision {
    const row = this.uow.execute((tx) =>
      tx.get<RevisionRow>("SELECT * FROM writing_revisions WHERE id = ?", id),
    );
    if (!row)
      throw new ApiProblem(
        404,
        "REVISION_NOT_FOUND",
        "revision does not exist",
      );
    return toRevision(row);
  }

  updateRevision(
    id: string,
    expectedVersion: number,
    input: {
      proposedTitle?: string;
      proposedContent?: string;
      rationale?: string;
    },
  ): Revision {
    return this.uow.execute((tx) => {
      const row = tx.get<RevisionRow>(
        "SELECT * FROM writing_revisions WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "REVISION_NOT_FOUND",
          "revision does not exist",
        );
      if (row.version !== expectedVersion || row.status !== "pending")
        throw new ApiProblem(412, "VERSION_CONFLICT", "revision changed");
      const updatedAt = new Date().toISOString();
      tx.run(
        `UPDATE writing_revisions SET proposed_title = ?, proposed_content = ?,
         rationale = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
        input.proposedTitle ?? row.proposed_title,
        input.proposedContent ?? row.proposed_content,
        input.rationale ?? row.rationale,
        updatedAt,
        id,
        expectedVersion,
      );
      return {
        ...toRevision(row),
        ...input,
        version: row.version + 1,
        updatedAt,
      };
    });
  }

  commitRevision(
    id: string,
    expectedRevisionVersion: number,
  ): { revision: Revision; chapter: Chapter } {
    return this.uow.execute((tx) => {
      const row = tx.get<RevisionRow>(
        "SELECT * FROM writing_revisions WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "REVISION_NOT_FOUND",
          "revision does not exist",
        );
      if (row.version !== expectedRevisionVersion || row.status !== "pending")
        throw new ApiProblem(412, "VERSION_CONFLICT", "revision changed");
      const chapter = this.updateChapterTx(
        tx,
        row.chapter_id,
        row.base_version,
        { title: row.proposed_title, content: row.proposed_content },
        "agent-commit",
      );
      const now = new Date().toISOString();
      tx.run(
        "UPDATE writing_revisions SET status = 'committed', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        now,
        id,
        expectedRevisionVersion,
      );
      return {
        revision: {
          ...toRevision(row),
          status: "committed",
          version: row.version + 1,
          updatedAt: now,
        },
        chapter,
      };
    });
  }

  discardRevision(id: string, expectedVersion: number): Revision {
    return this.uow.execute((tx) => {
      const row = tx.get<RevisionRow>(
        "SELECT * FROM writing_revisions WHERE id = ?",
        id,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "REVISION_NOT_FOUND",
          "revision does not exist",
        );
      if (row.version !== expectedVersion || row.status !== "pending")
        throw new ApiProblem(412, "VERSION_CONFLICT", "revision changed");
      const now = new Date().toISOString();
      tx.run(
        "UPDATE writing_revisions SET status = 'discarded', version = version + 1, updated_at = ? WHERE id = ?",
        now,
        id,
      );
      return {
        ...toRevision(row),
        status: "discarded",
        version: row.version + 1,
        updatedAt: now,
      };
    });
  }

  private chapterRow(tx: UnitOfWorkTransaction, id: string): ChapterRow {
    const row = tx.get<ChapterRow>(
      `SELECT ${chapterColumns} FROM writing_chapters WHERE id = ?`,
      id,
    );
    if (!row)
      throw new ApiProblem(404, "CHAPTER_NOT_FOUND", "chapter does not exist");
    return row;
  }

  private ensureWorkspace(tx: UnitOfWorkTransaction, projectId: string): void {
    const project = tx.get<{ id: string; target_word_count: number }>(
      "SELECT id, target_word_count FROM workspace_projects WHERE id = ?",
      projectId,
    );
    if (!project)
      throw new ApiProblem(404, "PROJECT_NOT_FOUND", "project does not exist");
    tx.run(
      `INSERT INTO writing_workspaces (project_id, version, word_goal, updated_at)
       VALUES (?, 1, ?, ?) ON CONFLICT(project_id) DO NOTHING`,
      projectId,
      project.target_word_count > 0
        ? Math.min(project.target_word_count, 2_000)
        : 2_000,
      new Date().toISOString(),
    );
  }

  private bumpWorkspace(tx: UnitOfWorkTransaction, projectId: string): void {
    tx.run(
      "UPDATE writing_workspaces SET version = version + 1, updated_at = ? WHERE project_id = ?",
      new Date().toISOString(),
      projectId,
    );
  }

  private snapshot(
    tx: UnitOfWorkTransaction,
    chapter: Chapter,
    reason: ChapterVersion["reason"],
  ): void {
    tx.run(
      `INSERT INTO writing_chapter_versions
       (id, chapter_id, chapter_version, title, content, fields_json, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      chapter.id,
      chapter.version,
      chapter.title,
      chapter.content,
      JSON.stringify({
        summary: chapter.summary,
        outline: chapter.outline,
        mainConflict: chapter.mainConflict,
        hook: chapter.hook,
        highlight: chapter.highlight,
        reversal: chapter.reversal,
        cliffhanger: chapter.cliffhanger,
        shortDramaNote: chapter.shortDramaNote,
        aiVideoNote: chapter.aiVideoNote,
        status: chapter.status,
      }),
      reason,
      new Date().toISOString(),
    );
  }

  private event(
    tx: UnitOfWorkTransaction,
    action: "created" | "updated",
    chapter: Chapter,
  ): void {
    tx.append({
      type: `writing.chapter-${action}.v1`,
      pluginId: "writing",
      aggregateType: "chapter",
      aggregateId: chapter.id,
      aggregateVersion: chapter.version,
      payload: chapter,
    });
  }
}

export function writingSourceImportAdopter(
  repository: WritingRepository,
): SourceImportAdopter {
  return {
    pluginId: "writing",
    adopt(tx, input) {
      return input.preview.chapters.map(
        (chapter) =>
          repository.insertChapter(
            tx,
            {
              projectId: input.projectId,
              title: chapter.title,
              content: chapter.content,
              summary: "",
              outline: "",
              mainConflict: "",
              hook: "",
              highlight: "",
              reversal: "",
              cliffhanger: "",
              shortDramaNote: "",
              aiVideoNote: "",
              status: "draft",
              ordinal: chapter.ordinal,
            },
            "import",
          ).id,
      );
    },
    undo(tx, resourceIds) {
      for (const id of resourceIds)
        tx.run("DELETE FROM writing_chapters WHERE id = ?", id);
    },
  };
}

export function writingArchiveContributor(
  repository: WritingRepository,
): ProjectArchiveContributor {
  return {
    pluginId: "writing",
    export(tx, projectId) {
      return tx
        .all<ChapterRow>(
          `SELECT ${chapterColumns} FROM writing_chapters WHERE project_id = ? ORDER BY ordinal`,
          projectId,
        )
        .map(toChapter);
    },
    import(tx, project: WorkspaceProjectContract, payload) {
      const chapters = Array.isArray(payload) ? (payload as Chapter[]) : [];
      for (const chapter of chapters)
        repository.insertChapter(
          tx,
          {
            projectId: project.id,
            title: chapter.title,
            summary: chapter.summary,
            content: chapter.content,
            outline: chapter.outline,
            mainConflict: chapter.mainConflict,
            hook: chapter.hook,
            highlight: chapter.highlight,
            reversal: chapter.reversal,
            cliffhanger: chapter.cliffhanger,
            shortDramaNote: chapter.shortDramaNote,
            aiVideoNote: chapter.aiVideoNote,
            status: chapter.status,
            ordinal: chapter.ordinal,
          },
          "import",
        );
    },
  };
}
