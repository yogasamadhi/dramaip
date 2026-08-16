import { randomUUID } from "node:crypto";

import { Service, type Context } from "@deepseek-ai/cordis";

import { ApiProblem } from "@dramaip/http";
import type {
  AgentContextProvider,
  AutomationRuntime,
  ChangePreview,
  ChangePreviewTarget,
  ChangeTargetHandler,
  ContextFragment,
  ContextRequest,
  ContextSnapshot,
  UnitOfWork,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api";

export type {
  AgentContextProvider,
  AutomationRuntime,
  ChangePreview,
  ChangePreviewTarget,
  ChangeTargetHandler,
  ContextFragment,
  ContextRequest,
  ContextSnapshot,
} from "@dramaip/plugin-api";

interface PreviewRow {
  id: string;
  project_id: string;
  session_id: string | null;
  run_id: string | null;
  task_type: string | null;
  rationale: string;
  status: ChangePreview["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

interface TargetRow {
  id: string;
  kind: string;
  target_id: string;
  base_version: number;
  patch_json: string;
  display_diff_json: string | null;
}

export class AutomationRuntimeService
  extends Service
  implements AutomationRuntime
{
  static provide = "automationRuntime";
  private readonly providers = new Map<string, AgentContextProvider>();
  private readonly handlers = new Map<string, ChangeTargetHandler>();

  constructor(
    ctx: Context,
    private readonly uow: UnitOfWork,
  ) {
    super(ctx, "automationRuntime");
  }

  registerContextProvider(provider: AgentContextProvider) {
    return this.register(this.providers, provider.id, provider);
  }

  registerChangeTarget(handler: ChangeTargetHandler) {
    return this.register(this.handlers, handler.kind, handler);
  }

  async snapshot(input: ContextRequest): Promise<ContextSnapshot> {
    const provided = await Promise.all(
      [...this.providers.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((provider) => provider.provide(input)),
    );
    const excluded = new Set(input.excluded ?? []);
    const pinned = new Set(input.pinned ?? []);
    const candidates = provided
      .flat()
      .filter((fragment) => !excluded.has(fragment.id))
      .map((fragment) => ({
        ...fragment,
        tokenEstimate:
          fragment.tokenEstimate || Math.ceil(fragment.content.length / 4),
      }))
      .sort((left, right) => {
        const pin = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
        return (
          pin ||
          right.priority - left.priority ||
          left.id.localeCompare(right.id)
        );
      });
    const budget = Math.max(
      1_000,
      Math.min(input.tokenBudget ?? 24_000, 200_000),
    );
    const fragments: ContextFragment[] = [];
    const truncated: Array<{ id: string; reason: string }> = [];
    let totalTokens = 0;
    for (const fragment of candidates) {
      if (
        totalTokens + fragment.tokenEstimate <= budget ||
        pinned.has(fragment.id)
      ) {
        fragments.push(fragment);
        totalTokens += fragment.tokenEstimate;
      } else {
        truncated.push({
          id: fragment.id,
          reason: `超过 ${budget} token 上下文预算`,
        });
      }
    }
    return {
      id: randomUUID(),
      request: input,
      fragments,
      totalTokens,
      truncated,
      createdAt: new Date().toISOString(),
    };
  }

  createPreview(input: {
    projectId: string;
    sessionId?: string;
    runId?: string;
    taskType?: string;
    rationale: string;
    targets: readonly Omit<ChangePreviewTarget, "id">[];
  }): ChangePreview {
    if (!input.targets.length)
      throw new ApiProblem(
        400,
        "CHANGE_PREVIEW_EMPTY",
        "change preview requires a target",
      );
    const now = new Date().toISOString();
    const preview: ChangePreview = {
      id: randomUUID(),
      ...input,
      targets: input.targets.map((target) => ({ id: randomUUID(), ...target })),
      status: "pending",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.uow.execute((tx) => {
      tx.run(
        `INSERT INTO automation_change_previews
         (id, project_id, session_id, run_id, task_type, rationale, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
        preview.id,
        preview.projectId,
        preview.sessionId ?? null,
        preview.runId ?? null,
        preview.taskType ?? null,
        preview.rationale,
        now,
        now,
      );
      for (const target of preview.targets)
        this.insertTarget(tx, preview.id, target);
      tx.append({
        type: "automation.change-preview-created.v1",
        pluginId: "automation",
        aggregateType: "change-preview",
        aggregateId: preview.id,
        aggregateVersion: 1,
        payload: preview,
      });
    });
    return preview;
  }

  getPreview(id: string): ChangePreview {
    return this.uow.execute((tx) => this.previewTx(tx, id));
  }

  updatePreview(
    id: string,
    expectedVersion: number,
    input: { rationale?: string; targets?: readonly ChangePreviewTarget[] },
  ): ChangePreview {
    return this.uow.execute((tx) => {
      const preview = this.previewTx(tx, id);
      this.assertPending(preview, expectedVersion);
      if (input.targets) {
        if (!input.targets.length)
          throw new ApiProblem(
            400,
            "CHANGE_PREVIEW_EMPTY",
            "change preview requires a target",
          );
        const existing = new Set(preview.targets.map((target) => target.id));
        if (input.targets.some((target) => !existing.has(target.id)))
          throw new ApiProblem(
            400,
            "CHANGE_TARGET_INVALID",
            "change target does not belong to preview",
          );
        tx.run(
          "DELETE FROM automation_change_preview_targets WHERE preview_id = ?",
          id,
        );
        for (const target of input.targets) this.insertTarget(tx, id, target);
      }
      const updatedAt = new Date().toISOString();
      tx.run(
        "UPDATE automation_change_previews SET rationale = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        input.rationale ?? preview.rationale,
        updatedAt,
        id,
        expectedVersion,
      );
      return this.previewTx(tx, id);
    });
  }

  commitPreview(id: string, expectedVersion: number): ChangePreview {
    return this.uow.execute((tx) => {
      const preview = this.previewTx(tx, id);
      this.assertPending(preview, expectedVersion);
      for (const target of preview.targets) {
        const handler = this.handlers.get(target.kind);
        if (!handler)
          throw new ApiProblem(
            409,
            "CHANGE_TARGET_UNAVAILABLE",
            `no handler for ${target.kind}`,
          );
        handler.apply(tx, target);
      }
      const updatedAt = new Date().toISOString();
      tx.run(
        "UPDATE automation_change_previews SET status = 'committed', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        updatedAt,
        id,
        expectedVersion,
      );
      const committed = this.previewTx(tx, id);
      tx.append({
        type: "automation.change-preview-committed.v1",
        pluginId: "automation",
        aggregateType: "change-preview",
        aggregateId: id,
        aggregateVersion: committed.version,
        payload: committed,
      });
      return committed;
    });
  }

  discardPreview(id: string, expectedVersion: number): ChangePreview {
    return this.uow.execute((tx) => {
      const preview = this.previewTx(tx, id);
      this.assertPending(preview, expectedVersion);
      tx.run(
        "UPDATE automation_change_previews SET status = 'discarded', version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        new Date().toISOString(),
        id,
        expectedVersion,
      );
      return this.previewTx(tx, id);
    });
  }

  private assertPending(preview: ChangePreview, expectedVersion: number): void {
    if (preview.version !== expectedVersion || preview.status !== "pending")
      throw new ApiProblem(412, "VERSION_CONFLICT", "change preview changed");
  }

  private insertTarget(
    tx: UnitOfWorkTransaction,
    previewId: string,
    target: ChangePreviewTarget,
  ): void {
    tx.run(
      `INSERT INTO automation_change_preview_targets
       (id, preview_id, kind, target_id, base_version, patch_json, display_diff_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      target.id,
      previewId,
      target.kind,
      target.targetId,
      target.baseVersion,
      JSON.stringify(target.patch),
      target.displayDiff === undefined
        ? null
        : JSON.stringify(target.displayDiff),
    );
  }

  private previewTx(tx: UnitOfWorkTransaction, id: string): ChangePreview {
    const row = tx.get<PreviewRow>(
      "SELECT * FROM automation_change_previews WHERE id = ?",
      id,
    );
    if (!row)
      throw new ApiProblem(
        404,
        "CHANGE_PREVIEW_NOT_FOUND",
        "change preview does not exist",
      );
    const targets = tx
      .all<TargetRow>(
        "SELECT id, kind, target_id, base_version, patch_json, display_diff_json FROM automation_change_preview_targets WHERE preview_id = ? ORDER BY rowid",
        id,
      )
      .map((target) => ({
        id: target.id,
        kind: target.kind,
        targetId: target.target_id,
        baseVersion: target.base_version,
        patch: JSON.parse(target.patch_json) as Record<string, unknown>,
        ...(target.display_diff_json
          ? { displayDiff: JSON.parse(target.display_diff_json) as unknown }
          : {}),
      }));
    return {
      id: row.id,
      projectId: row.project_id,
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(row.task_type ? { taskType: row.task_type } : {}),
      rationale: row.rationale,
      status: row.status,
      targets,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private register<T>(map: Map<string, T>, id: string, value: T) {
    if (map.has(id)) throw new Error(`duplicate automation extension: ${id}`);
    map.set(id, value);
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      map.delete(id);
    };
    this.ctx.effect(() => dispose, `automation-extension:${id}`);
    return dispose;
  }
}
