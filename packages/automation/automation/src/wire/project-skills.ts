/**
 * The shapes the project skill operations declare.
 *
 * @module @dramaip/automation-automation/wire/project-skills
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/projectSkillsCreate` (`project-skills.create`). */
export type ProjectSkillsCreateInput = {
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `automation/projectSkillsCreate` (`project-skills.create`). */
export type ProjectSkillsCreateResult = {
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

/** Answer of `automation/projectSkillsGet` (`project-skills.get`). */
export type ProjectSkillsGetResult = {
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

/** Query of `automation/projectSkillsList` (`project-skills.list`). */
export type ProjectSkillsListQuery = {
  projectId?: string;
};

/** Answer of `automation/projectSkillsList` (`project-skills.list`). */
export type ProjectSkillsListResult = {
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

/** Input of `automation/projectSkillsUpdate` (`project-skills.update`). */
export type ProjectSkillsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `automation/projectSkillsUpdate` (`project-skills.update`). */
export type ProjectSkillsUpdateResult = {
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
