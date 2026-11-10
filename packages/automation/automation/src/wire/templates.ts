/**
 * The shapes the template operations declare.
 *
 * @module @dramaip/automation-automation/wire/templates
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/templatesCreate` (`templates.create`). */
export type TemplatesCreateInput = {
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `automation/templatesCreate` (`templates.create`). */
export type TemplatesCreateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `automation/templatesGet` (`templates.get`). */
export type TemplatesGetResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `automation/templatesList` (`templates.list`). */
export type TemplatesListQuery = {
  projectId?: string;
};

/** Answer of `automation/templatesList` (`templates.list`). */
export type TemplatesListResult = {
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

/** Input of `automation/templatesRun` (`templates.run`). */
export type TemplatesRunInput = {
  projectId?: string;
  variables?: Record<string, string | number | boolean>;
};

/** Answer of `automation/templatesRun` (`templates.run`). */
export type TemplatesRunResult = {
  runId: string;
  rendered: string;
  variables: string[];
  missing: string[];
  createdAt: string;
};

/** Input of `automation/templatesUpdate` (`templates.update`). */
export type TemplatesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `automation/templatesUpdate` (`templates.update`). */
export type TemplatesUpdateResult = {
  id: string;
  domain: string;
  projectId?: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};
