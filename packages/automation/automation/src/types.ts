/**
 * The wire types of the namespace, one module per operation family.
 *
 * Every family lives in its own module; this entry point re-exports
 * them, so an importer names the namespace and not the family.
 * @module @dramaip/automation-automation/wire
 */

export type {
  AgentSchemesCreateInput,
  AgentSchemesCreateResult,
  AgentSchemesGetResult,
  AgentSchemesListQuery,
  AgentSchemesListResult,
  AgentSchemesUpdateInput,
  AgentSchemesUpdateResult,
} from "./wire/agent-schemes.js";

export type {
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
} from "./wire/change-previews.js";

export type {
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
} from "./wire/creation.js";

export type {
  InspirationsCreateInput,
  InspirationsCreateResult,
  InspirationsGetResult,
  InspirationsListQuery,
  InspirationsListResult,
  InspirationsUpdateInput,
  InspirationsUpdateResult,
} from "./wire/inspirations.js";

export type {
  PilotPlansActionInput,
  PilotPlansActionResult,
  PilotPlansCreateInput,
  PilotPlansCreateResult,
  PilotPlansListResult,
} from "./wire/pilot-plans.js";

export type {
  ProjectSkillsCreateInput,
  ProjectSkillsCreateResult,
  ProjectSkillsGetResult,
  ProjectSkillsListQuery,
  ProjectSkillsListResult,
  ProjectSkillsUpdateInput,
  ProjectSkillsUpdateResult,
} from "./wire/project-skills.js";

export type {
  ProviderActionPreviewsDiscardResult,
  ProviderActionPreviewsExecuteResult,
  ProviderActionPreviewsGetResult,
  ProviderActionPreviewsSummariesQuery,
  ProviderActionPreviewsSummariesResult,
} from "./wire/provider-action-previews.js";

export type {
  RevisionsCommitInput,
  RevisionsCommitResult,
  RevisionsCreateInput,
  RevisionsCreateResult,
  RevisionsDiscardResult,
  RevisionsGetResult,
  RevisionsListQuery,
  RevisionsListResult,
} from "./wire/revisions.js";

export type {
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
} from "./wire/tasks.js";

export type {
  TemplateRunsListQuery,
  TemplateRunsListResult,
} from "./wire/template-runs.js";

export type {
  TemplatesCreateInput,
  TemplatesCreateResult,
  TemplatesGetResult,
  TemplatesListQuery,
  TemplatesListResult,
  TemplatesRunInput,
  TemplatesRunResult,
  TemplatesUpdateInput,
  TemplatesUpdateResult,
} from "./wire/templates.js";

export type {
  WorkflowsRunEpisodeInput,
  WorkflowsRunEpisodeResult,
} from "./wire/workflows.js";
