/**
 * The shapes the template run operation declares.
 *
 * @module @dramaip/automation-automation/wire/template-runs
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Query of `automation/templateRunsList` (`template-runs.list`). */
export type TemplateRunsListQuery = {
  projectId?: string;
};

/** Answer of `automation/templateRunsList` (`template-runs.list`). */
export type TemplateRunsListResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];
