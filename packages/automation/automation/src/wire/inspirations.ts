/**
 * The shapes the inspiration operations declare.
 *
 * @module @dramaip/automation-automation/wire/inspirations
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/inspirationsCreate` (`inspirations.create`). */
export type InspirationsCreateInput = {
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `automation/inspirationsCreate` (`inspirations.create`). */
export type InspirationsCreateResult = {
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

/** Answer of `automation/inspirationsGet` (`inspirations.get`). */
export type InspirationsGetResult = {
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

/** Query of `automation/inspirationsList` (`inspirations.list`). */
export type InspirationsListQuery = {
  projectId?: string;
};

/** Answer of `automation/inspirationsList` (`inspirations.list`). */
export type InspirationsListResult = {
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

/** Input of `automation/inspirationsUpdate` (`inspirations.update`). */
export type InspirationsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `automation/inspirationsUpdate` (`inspirations.update`). */
export type InspirationsUpdateResult = {
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
