import { createHash } from "node:crypto";
import {
  ChapterPreviewRevisionEffortSchema,
  type ChangePreview,
} from "@dramaip/contracts/automation";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const previewRevisionMigration: PluginMigration = {
  id: "automation.0011.preview-revision-journal",
  pluginId: "automation",
  version: "3.0.0-alpha.4",
  dependsOn: ["automation.0010.planning-metric-receipts"],
  sql: `CREATE TABLE automation_preview_revision_heads (
    preview_id TEXT PRIMARY KEY REFERENCES automation_change_previews(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('initial','historical','rebase')),
    source_preview_id TEXT, source_sha256 TEXT,
    initial_sha256 TEXT NOT NULL, current_sha256 TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0), created_at TEXT NOT NULL
  );
  CREATE TABLE automation_preview_revision_edits (
    preview_id TEXT NOT NULL REFERENCES automation_preview_revision_heads(preview_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    before_sha256 TEXT NOT NULL, after_sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL,
    PRIMARY KEY(preview_id,sequence)
  );`,
};

interface Head {
  preview_id: string;
  project_id: string;
  chapter_id: string;
  origin: "initial" | "historical" | "rebase";
  source_preview_id: string | null;
  source_sha256: string | null;
  initial_sha256: string;
  current_sha256: string;
  sequence: number;
  created_at: string;
}
interface Edit {
  preview_id: string;
  sequence: number;
  before_sha256: string;
  after_sha256: string;
  recorded_at: string;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const isSha = (text: unknown) =>
  typeof text === "string" && /^[a-f0-9]{64}$/u.test(text);
export function chapterCandidate(value: ChangePreview) {
  const target = value.targets.length === 1 ? value.targets[0] : undefined;
  return target?.kind === "chapter" && typeof target.patch.content === "string"
    ? { chapterId: target.id, content: target.patch.content }
    : undefined;
}
function head(tx: UnitOfWorkTransaction, id: string) {
  return tx.get<Head>(
    "SELECT * FROM automation_preview_revision_heads WHERE preview_id=?",
    id,
  );
}
function start(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
  origin: Head["origin"],
  source?: ChangePreview,
) {
  const candidate = chapterCandidate(value);
  if (!candidate) return;
  const original = source && chapterCandidate(source);
  if (
    source &&
    (!original ||
      source.projectId !== value.projectId ||
      source.taskId !== value.taskId ||
      original.chapterId !== candidate.chapterId)
  )
    throw new Error("The original candidate revision scope is invalid.");
  tx.run(
    `INSERT INTO automation_preview_revision_heads(preview_id,project_id,chapter_id,origin,
    source_preview_id,source_sha256,initial_sha256,current_sha256,sequence,created_at)
    VALUES (?,?,?,?,?,?,?,?,0,?)`,
    value.id,
    value.projectId,
    candidate.chapterId,
    origin,
    source?.id ?? null,
    original ? sha(original.content) : null,
    sha(candidate.content),
    sha(candidate.content),
    origin === "historical" ? new Date().toISOString() : value.createdAt,
  );
}
export function recordInitialCandidate(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
) {
  start(tx, value, "initial");
}
export function recordCandidateRebase(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
  source: ChangePreview,
) {
  start(tx, value, "rebase", source);
}
export function recordCandidateEdit(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
  content: string,
) {
  const candidate = chapterCandidate(value);
  if (!candidate || candidate.content === content) return;
  let h = head(tx, value.id);
  if (!h) {
    start(tx, value, "historical");
    h = head(tx, value.id)!;
  }
  if (
    h.project_id !== value.projectId ||
    h.chapter_id !== candidate.chapterId ||
    h.current_sha256 !== sha(candidate.content)
  )
    throw new Error("The saved candidate revision journal has changed.");
  const next = h.sequence + 1;
  tx.run(
    `INSERT INTO automation_preview_revision_edits(preview_id,sequence,before_sha256,after_sha256,recorded_at)
    VALUES (?,?,?,?,?)`,
    value.id,
    next,
    h.current_sha256,
    sha(content),
    new Date().toISOString(),
  );
  tx.run(
    "UPDATE automation_preview_revision_heads SET current_sha256=?,sequence=? WHERE preview_id=?",
    sha(content),
    next,
    value.id,
  );
  return next;
}

/** No cross-owner reads and no guessed historical zero. All reads share one snapshot. */
export function readCandidateRevisionEffort(
  tx: UnitOfWorkTransaction,
  value: ChangePreview,
  readPreview: (id: string) => ChangePreview | undefined,
) {
  const candidate = chapterCandidate(value);
  if (!candidate) return undefined;
  let current = value,
    root = value.id,
    updates = 0,
    rebases = 0,
    changedRebases = 0;
  let coverage: "complete" | "partial" | "untracked" = "complete";
  const seen = new Set<string>(),
    material: unknown[] = [];
  for (;;) {
    if (seen.has(current.id) || seen.size >= 500)
      throw new Error("Invalid or excessive original candidate chain.");
    seen.add(current.id);
    root = current.id;
    const target = chapterCandidate(current);
    if (
      !target ||
      current.projectId !== value.projectId ||
      current.taskId !== value.taskId ||
      target.chapterId !== candidate.chapterId
    )
      throw new Error(
        "A candidate chain cannot change its original owner scope.",
      );
    const h = head(tx, current.id);
    if (!h) {
      coverage = seen.size === 1 ? "untracked" : "partial";
      break;
    }
    const edits = tx.all<Edit>(
      "SELECT * FROM automation_preview_revision_edits WHERE preview_id=? ORDER BY sequence LIMIT 10001",
      current.id,
    );
    if (
      h.preview_id !== current.id ||
      h.project_id !== value.projectId ||
      h.chapter_id !== candidate.chapterId ||
      !["initial", "historical", "rebase"].includes(h.origin) ||
      !Number.isSafeInteger(h.sequence) ||
      h.sequence < 0 ||
      h.sequence > 10000 ||
      !isSha(h.initial_sha256) ||
      !isSha(h.current_sha256) ||
      !Number.isFinite(Date.parse(h.created_at)) ||
      edits.length !== h.sequence ||
      h.current_sha256 !== sha(target.content)
    )
      throw new Error(
        "Original candidate revision history is incomplete or invalid.",
      );
    let before = h.initial_sha256;
    for (const [index, edit] of edits.entries()) {
      if (
        edit.preview_id !== current.id ||
        edit.sequence !== index + 1 ||
        edit.before_sha256 !== before ||
        !isSha(edit.after_sha256) ||
        edit.after_sha256 === before ||
        !Number.isFinite(Date.parse(edit.recorded_at))
      )
        throw new Error("Original candidate revision sequence is invalid.");
      before = edit.after_sha256;
    }
    if (before !== h.current_sha256)
      throw new Error("Original candidate revision digest is invalid.");
    updates += edits.length;
    material.push({ head: h, edits });
    if (h.origin !== "rebase") {
      if (h.source_preview_id !== null || h.source_sha256 !== null)
        throw new Error("An unlinked candidate cannot claim a rebase.");
      coverage = h.origin === "historical" ? "partial" : "complete";
      break;
    }
    if (!h.source_preview_id || !isSha(h.source_sha256))
      throw new Error("Original rebase source is invalid.");
    const source = readPreview(h.source_preview_id);
    const sourceCandidate = source && chapterCandidate(source);
    if (
      !source ||
      source.status !== "conflicted" ||
      !sourceCandidate ||
      sha(sourceCandidate.content) !== h.source_sha256
    )
      throw new Error("Original rebase source is missing or changed.");
    rebases++;
    if (h.source_sha256 !== h.initial_sha256) changedRebases++;
    current = source;
  }
  return ChapterPreviewRevisionEffortSchema.parse({
    format: "chapter-preview-revision-effort-v1",
    projectId: value.projectId,
    previewId: value.id,
    chapterId: candidate.chapterId,
    ...(value.taskId ? { taskId: value.taskId } : {}),
    rootPreviewId: root,
    contentHash: value.contentHash,
    candidateSha256: sha(candidate.content),
    journalSha256: sha(JSON.stringify(material)),
    status: value.status,
    coverage,
    observedContentUpdates: updates,
    observedRebases: rebases,
    observedContentChangingRebases: changedRebases,
    localRevisionCount:
      coverage === "complete" ? updates + changedRebases : null,
    scope: "exact-chapter-preview-chain",
    qualityStatus: "unverified",
  });
}
