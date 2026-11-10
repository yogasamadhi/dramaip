/**
 * Host face of the automation domain. It owns the `automation` Remote namespace:
 * workflows, agent schemes, project skills, templates and their runs, inspirations, pilot plans, revisions, tasks and change previews. Each method names the `/api/v2` operation it replaces.
 *
 * The methods claim the operations from the operation registry and run the
 * automation plugin's handlers in process
 * (`@dramaip/infra-operations/operations`); a handler's problem answer arrives
 * as the `compat/problem` RemoteError.
 * @module @dramaip/automation-automation
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  claimCompatOperations,
  compatCallOf,
  type CompatOperations,
} from "@dramaip/infra-operations/operations";
import { Remote, TypertRemoteService } from "@dramaip/infra-typert-protocol";
import type {
  AgentSchemesCreateInput,
  AgentSchemesCreateResult,
  AgentSchemesGetResult,
  AgentSchemesListQuery,
  AgentSchemesListResult,
  AgentSchemesUpdateInput,
  AgentSchemesUpdateResult,
  ChangePreviewsCommitResult,
  ChangePreviewsDiscardResult,
  ChangePreviewsGetResult,
  ChangePreviewsMergeResult,
  ChangePreviewsRebaseInput,
  ChangePreviewsRebaseResult,
  ChangePreviewsRevisionEffortQuery,
  ChangePreviewsRevisionEffortResult,
  ChangePreviewsUpdateContentInput,
  ChangePreviewsUpdateContentResult,
  CreationActionInput,
  CreationActionResult,
  CreationExecutionQuery,
  CreationExecutionResult,
  CreationGetResult,
  CreationListQuery,
  CreationListResult,
  CreationMergeResult,
  CreationRebaseInput,
  CreationRebaseResult,
  CreationRecordMergeResult,
  CreationRecordRebaseInput,
  CreationRecordRebaseResult,
  CreationStartInput,
  CreationStartResult,
  InspirationsCreateInput,
  InspirationsCreateResult,
  InspirationsGetResult,
  InspirationsListQuery,
  InspirationsListResult,
  InspirationsUpdateInput,
  InspirationsUpdateResult,
  PilotPlansActionInput,
  PilotPlansActionResult,
  PilotPlansCreateInput,
  PilotPlansCreateResult,
  PilotPlansListResult,
  ProjectSkillsCreateInput,
  ProjectSkillsCreateResult,
  ProjectSkillsGetResult,
  ProjectSkillsListQuery,
  ProjectSkillsListResult,
  ProjectSkillsUpdateInput,
  ProjectSkillsUpdateResult,
  ProviderActionPreviewsDiscardResult,
  ProviderActionPreviewsExecuteResult,
  ProviderActionPreviewsGetResult,
  ProviderActionPreviewsSummariesQuery,
  ProviderActionPreviewsSummariesResult,
  RevisionsCommitInput,
  RevisionsCommitResult,
  RevisionsCreateInput,
  RevisionsCreateResult,
  RevisionsDiscardResult,
  RevisionsGetResult,
  RevisionsListQuery,
  RevisionsListResult,
  TasksCancelResult,
  TasksCreateInput,
  TasksCreateResult,
  TasksListResult,
  TasksRetryInput,
  TasksRetryResult,
  TasksSetAttentionInput,
  TasksSetAttentionResult,
  TasksWorklistQuery,
  TasksWorklistResult,
  TemplateRunsListQuery,
  TemplateRunsListResult,
  TemplatesCreateInput,
  TemplatesCreateResult,
  TemplatesGetResult,
  TemplatesListQuery,
  TemplatesListResult,
  TemplatesRunInput,
  TemplatesRunResult,
  TemplatesUpdateInput,
  TemplatesUpdateResult,
  WorkflowsRunEpisodeInput,
  WorkflowsRunEpisodeResult,
} from "./types.ts";
import {
  automationLegacyRoutes,
  type AutomationLegacyMethod,
} from "./legacy.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the `automation` Remote namespace. */
    automationController: AutomationController;
  }
}

/** The `/api/v2` operations this namespace replaces. */
export const replacedOperations: readonly string[] =
  automationLegacyRoutes.routes.map((route) => route.operationId);

/** Host service backing the generated `ctx.remote.automation` namespace. */
export class AutomationController extends TypertRemoteService {
  static inject = ["operations"];

  private readonly compat: CompatOperations;

  constructor(ctx: Context) {
    super(ctx, "automationController", { namespace: "automation" });
    this.compat = claimCompatOperations(ctx, replacedOperations);
  }

  /** Run the replaced operation behind `method` with its arguments. */
  private run<T>(
    method: AutomationLegacyMethod,
    ...args: readonly unknown[]
  ): Promise<T> {
    const route = automationLegacyRoutes.routes.find(
      (candidate) => candidate.remote === method,
    )!;
    return this.compat.call(
      route.operationId,
      compatCallOf(route, args),
    ) as Promise<T>;
  }

  /**
   * Runs `POST /api/v2/agent-schemes`.
   * @replaces agent-schemes.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  agentSchemesCreate(
    input: AgentSchemesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AgentSchemesCreateResult> {
    return this.run("agentSchemesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/agent-schemes/{id}`.
   * @replaces agent-schemes.get
   * @param id - the `id` path parameter.
   */
  @Remote
  agentSchemesGet(id: string): Promise<AgentSchemesGetResult> {
    return this.run("agentSchemesGet", id);
  }

  /**
   * Runs `GET /api/v2/agent-schemes`.
   * @replaces agent-schemes.list
   * @param query - the query parameters.
   */
  @Remote
  agentSchemesList(
    query?: AgentSchemesListQuery,
  ): Promise<AgentSchemesListResult> {
    return this.run("agentSchemesList", query);
  }

  /**
   * Runs `DELETE /api/v2/agent-schemes/{id}`.
   * @replaces agent-schemes.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  agentSchemesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("agentSchemesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/agent-schemes/{id}`.
   * @replaces agent-schemes.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  agentSchemesUpdate(
    id: string,
    input: AgentSchemesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<AgentSchemesUpdateResult> {
    return this.run("agentSchemesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/change-previews/{id}/commit`.
   * @replaces change-previews.commit
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  changePreviewsCommit(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChangePreviewsCommitResult> {
    return this.run("changePreviewsCommit", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/change-previews/{id}/discard`.
   * @replaces change-previews.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  changePreviewsDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChangePreviewsDiscardResult> {
    return this.run("changePreviewsDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/change-previews/{id}`.
   * @replaces change-previews.get
   * @param id - the `id` path parameter.
   */
  @Remote
  changePreviewsGet(id: string): Promise<ChangePreviewsGetResult> {
    return this.run("changePreviewsGet", id);
  }

  /**
   * Runs `GET /api/v2/change-previews/{id}/merge`.
   * @replaces change-previews.merge
   * @param id - the `id` path parameter.
   */
  @Remote
  changePreviewsMerge(id: string): Promise<ChangePreviewsMergeResult> {
    return this.run("changePreviewsMerge", id);
  }

  /**
   * Runs `POST /api/v2/change-previews/{id}/rebase`.
   * @replaces change-previews.rebase
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  changePreviewsRebase(
    id: string,
    input: ChangePreviewsRebaseInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChangePreviewsRebaseResult> {
    return this.run("changePreviewsRebase", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/change-previews/{id}/revision-effort`.
   * @replaces change-previews.revisionEffort
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  changePreviewsRevisionEffort(
    id: string,
    query: ChangePreviewsRevisionEffortQuery,
  ): Promise<ChangePreviewsRevisionEffortResult> {
    return this.run("changePreviewsRevisionEffort", id, query);
  }

  /**
   * Runs `PUT /api/v2/change-previews/{id}/content`.
   * @replaces change-previews.updateContent
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  changePreviewsUpdateContent(
    id: string,
    input: ChangePreviewsUpdateContentInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ChangePreviewsUpdateContentResult> {
    return this.run(
      "changePreviewsUpdateContent",
      id,
      input,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/workflows/creation/{id}/actions`.
   * @replaces creation.action
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creationAction(
    id: string,
    input: CreationActionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreationActionResult> {
    return this.run("creationAction", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/workflows/creation/{id}/execution`.
   * @replaces creation.execution
   * @param id - the `id` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  creationExecution(
    id: string,
    query: CreationExecutionQuery,
  ): Promise<CreationExecutionResult> {
    return this.run("creationExecution", id, query);
  }

  /**
   * Runs `GET /api/v2/workflows/creation/{id}`.
   * @replaces creation.get
   * @param id - the `id` path parameter.
   */
  @Remote
  creationGet(id: string): Promise<CreationGetResult> {
    return this.run("creationGet", id);
  }

  /**
   * Runs `GET /api/v2/workflows/creation`.
   * @replaces creation.list
   * @param query - the query parameters.
   */
  @Remote
  creationList(query?: CreationListQuery): Promise<CreationListResult> {
    return this.run("creationList", query);
  }

  /**
   * Runs `GET /api/v2/workflows/creation/{id}/merge`.
   * @replaces creation.merge
   * @param id - the `id` path parameter.
   */
  @Remote
  creationMerge(id: string): Promise<CreationMergeResult> {
    return this.run("creationMerge", id);
  }

  /**
   * Runs `POST /api/v2/workflows/creation/{id}/rebase`.
   * @replaces creation.rebase
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creationRebase(
    id: string,
    input: CreationRebaseInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreationRebaseResult> {
    return this.run("creationRebase", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/workflows/creation/{id}/record-merge`.
   * @replaces creation.recordMerge
   * @param id - the `id` path parameter.
   */
  @Remote
  creationRecordMerge(id: string): Promise<CreationRecordMergeResult> {
    return this.run("creationRecordMerge", id);
  }

  /**
   * Runs `POST /api/v2/workflows/creation/{id}/record-rebase`.
   * @replaces creation.recordRebase
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creationRecordRebase(
    id: string,
    input: CreationRecordRebaseInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreationRecordRebaseResult> {
    return this.run("creationRecordRebase", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/workflows/creation`.
   * @replaces creation.start
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  creationStart(
    input: CreationStartInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<CreationStartResult> {
    return this.run("creationStart", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/inspirations`.
   * @replaces inspirations.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationsCreate(
    input: InspirationsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationsCreateResult> {
    return this.run("inspirationsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/inspirations/{id}`.
   * @replaces inspirations.get
   * @param id - the `id` path parameter.
   */
  @Remote
  inspirationsGet(id: string): Promise<InspirationsGetResult> {
    return this.run("inspirationsGet", id);
  }

  /**
   * Runs `GET /api/v2/inspirations`.
   * @replaces inspirations.list
   * @param query - the query parameters.
   */
  @Remote
  inspirationsList(
    query?: InspirationsListQuery,
  ): Promise<InspirationsListResult> {
    return this.run("inspirationsList", query);
  }

  /**
   * Runs `DELETE /api/v2/inspirations/{id}`.
   * @replaces inspirations.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("inspirationsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/inspirations/{id}`.
   * @replaces inspirations.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  inspirationsUpdate(
    id: string,
    input: InspirationsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<InspirationsUpdateResult> {
    return this.run("inspirationsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Updated pilot plan. Runs `POST /api/v2/pilot-plans/{id}/action`.
   * @replaces pilot-plans.action
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  pilotPlansAction(
    id: string,
    input: PilotPlansActionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PilotPlansActionResult> {
    return this.run("pilotPlansAction", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Created pilot plan. Runs `POST /api/v2/pilot-plans`.
   * @replaces pilot-plans.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  pilotPlansCreate(
    input: PilotPlansCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<PilotPlansCreateResult> {
    return this.run("pilotPlansCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Pilot plans. Runs `GET /api/v2/projects/{id}/pilot-plans`.
   * @replaces pilot-plans.list
   * @param id - the `id` path parameter.
   */
  @Remote
  pilotPlansList(id: string): Promise<PilotPlansListResult> {
    return this.run("pilotPlansList", id);
  }

  /**
   * Runs `POST /api/v2/project-skills`.
   * @replaces project-skills.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectSkillsCreate(
    input: ProjectSkillsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectSkillsCreateResult> {
    return this.run("projectSkillsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/project-skills/{id}`.
   * @replaces project-skills.get
   * @param id - the `id` path parameter.
   */
  @Remote
  projectSkillsGet(id: string): Promise<ProjectSkillsGetResult> {
    return this.run("projectSkillsGet", id);
  }

  /**
   * Runs `GET /api/v2/project-skills`.
   * @replaces project-skills.list
   * @param query - the query parameters.
   */
  @Remote
  projectSkillsList(
    query?: ProjectSkillsListQuery,
  ): Promise<ProjectSkillsListResult> {
    return this.run("projectSkillsList", query);
  }

  /**
   * Runs `DELETE /api/v2/project-skills/{id}`.
   * @replaces project-skills.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectSkillsRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("projectSkillsRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/project-skills/{id}`.
   * @replaces project-skills.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  projectSkillsUpdate(
    id: string,
    input: ProjectSkillsUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProjectSkillsUpdateResult> {
    return this.run("projectSkillsUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/provider-action-previews/{id}/discard`.
   * @replaces provider-action-previews.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providerActionPreviewsDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProviderActionPreviewsDiscardResult> {
    return this.run(
      "providerActionPreviewsDiscard",
      id,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `POST /api/v2/provider-action-previews/{id}/execute`.
   * @replaces provider-action-previews.execute
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  providerActionPreviewsExecute(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<ProviderActionPreviewsExecuteResult> {
    return this.run(
      "providerActionPreviewsExecute",
      id,
      ifMatch,
      idempotencyKey,
    );
  }

  /**
   * Runs `GET /api/v2/provider-action-previews/{id}`.
   * @replaces provider-action-previews.get
   * @param id - the `id` path parameter.
   */
  @Remote
  providerActionPreviewsGet(
    id: string,
  ): Promise<ProviderActionPreviewsGetResult> {
    return this.run("providerActionPreviewsGet", id);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/provider-action-preview-summaries`.
   * @replaces provider-action-previews.summaries
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  providerActionPreviewsSummaries(
    projectId: string,
    query?: ProviderActionPreviewsSummariesQuery,
  ): Promise<ProviderActionPreviewsSummariesResult> {
    return this.run("providerActionPreviewsSummaries", projectId, query);
  }

  /**
   * Runs `POST /api/v2/revisions/{id}/commit`.
   * @replaces revisions.commit
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  revisionsCommit(
    id: string,
    input: RevisionsCommitInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RevisionsCommitResult> {
    return this.run("revisionsCommit", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/revisions`.
   * @replaces revisions.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  revisionsCreate(
    input: RevisionsCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RevisionsCreateResult> {
    return this.run("revisionsCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/revisions/{id}/discard`.
   * @replaces revisions.discard
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  revisionsDiscard(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<RevisionsDiscardResult> {
    return this.run("revisionsDiscard", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/revisions/{id}`.
   * @replaces revisions.get
   * @param id - the `id` path parameter.
   */
  @Remote
  revisionsGet(id: string): Promise<RevisionsGetResult> {
    return this.run("revisionsGet", id);
  }

  /**
   * Runs `GET /api/v2/projects/{projectId}/revision-previews`.
   * @replaces revisions.list
   * @param projectId - the `projectId` path parameter.
   * @param query - the query parameters.
   */
  @Remote
  revisionsList(
    projectId: string,
    query?: RevisionsListQuery,
  ): Promise<RevisionsListResult> {
    return this.run("revisionsList", projectId, query);
  }

  /**
   * Runs `POST /api/v2/tasks/{id}/cancel`.
   * @replaces tasks.cancel
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  tasksCancel(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TasksCancelResult> {
    return this.run("tasksCancel", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/tasks`.
   * @replaces tasks.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  tasksCreate(
    input: TasksCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TasksCreateResult> {
    return this.run("tasksCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/tasks`.
   * @replaces tasks.list
   */
  @Remote
  tasksList(): Promise<TasksListResult> {
    return this.run("tasksList");
  }

  /**
   * Runs `POST /api/v2/tasks/{id}/retry`.
   * @replaces tasks.retry
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  tasksRetry(
    id: string,
    input: TasksRetryInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TasksRetryResult> {
    return this.run("tasksRetry", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/tasks/{id}/attention`.
   * @replaces tasks.setAttention
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  tasksSetAttention(
    id: string,
    input: TasksSetAttentionInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TasksSetAttentionResult> {
    return this.run("tasksSetAttention", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/task-worklist`.
   * @replaces tasks.worklist
   * @param query - the query parameters.
   */
  @Remote
  tasksWorklist(query?: TasksWorklistQuery): Promise<TasksWorklistResult> {
    return this.run("tasksWorklist", query);
  }

  /**
   * Runs `GET /api/v2/template-runs`.
   * @replaces template-runs.list
   * @param query - the query parameters.
   */
  @Remote
  templateRunsList(
    query?: TemplateRunsListQuery,
  ): Promise<TemplateRunsListResult> {
    return this.run("templateRunsList", query);
  }

  /**
   * Runs `POST /api/v2/templates`.
   * @replaces templates.create
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  templatesCreate(
    input: TemplatesCreateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TemplatesCreateResult> {
    return this.run("templatesCreate", input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `GET /api/v2/templates/{id}`.
   * @replaces templates.get
   * @param id - the `id` path parameter.
   */
  @Remote
  templatesGet(id: string): Promise<TemplatesGetResult> {
    return this.run("templatesGet", id);
  }

  /**
   * Runs `GET /api/v2/templates`.
   * @replaces templates.list
   * @param query - the query parameters.
   */
  @Remote
  templatesList(query?: TemplatesListQuery): Promise<TemplatesListResult> {
    return this.run("templatesList", query);
  }

  /**
   * Runs `DELETE /api/v2/templates/{id}`.
   * @replaces templates.remove
   * @param id - the `id` path parameter.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  templatesRemove(
    id: string,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    return this.run("templatesRemove", id, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/templates/{id}/run`.
   * @replaces templates.run
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  templatesRun(
    id: string,
    input: TemplatesRunInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TemplatesRunResult> {
    return this.run("templatesRun", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `PATCH /api/v2/templates/{id}`.
   * @replaces templates.update
   * @param id - the `id` path parameter.
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  templatesUpdate(
    id: string,
    input: TemplatesUpdateInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<TemplatesUpdateResult> {
    return this.run("templatesUpdate", id, input, ifMatch, idempotencyKey);
  }

  /**
   * Runs `POST /api/v2/workflows/episodes/run`.
   * @replaces workflows.runEpisode
   * @param input - the request body.
   * @param ifMatch - the version read (the original `If-Match`).
   * @param idempotencyKey - the write's replay key (the original `Idempotency-Key`).
   */
  @Remote
  workflowsRunEpisode(
    input: WorkflowsRunEpisodeInput,
    ifMatch?: string,
    idempotencyKey?: string,
  ): Promise<WorkflowsRunEpisodeResult> {
    return this.run("workflowsRunEpisode", input, ifMatch, idempotencyKey);
  }
}

export default AutomationController;
