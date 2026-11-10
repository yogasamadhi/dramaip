/**
 * The shapes the agent scheme operations declare.
 *
 * @module @dramaip/automation-automation/wire/agent-schemes
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `automation/agentSchemesCreate` (`agent-schemes.create`). */
export type AgentSchemesCreateInput = {
  projectId?: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `automation/agentSchemesCreate` (`agent-schemes.create`). */
export type AgentSchemesCreateResult = {
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

/** Answer of `automation/agentSchemesGet` (`agent-schemes.get`). */
export type AgentSchemesGetResult = {
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

/** Query of `automation/agentSchemesList` (`agent-schemes.list`). */
export type AgentSchemesListQuery = {
  projectId?: string;
};

/** Answer of `automation/agentSchemesList` (`agent-schemes.list`). */
export type AgentSchemesListResult = {
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

/** Input of `automation/agentSchemesUpdate` (`agent-schemes.update`). */
export type AgentSchemesUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `automation/agentSchemesUpdate` (`agent-schemes.update`). */
export type AgentSchemesUpdateResult = {
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
