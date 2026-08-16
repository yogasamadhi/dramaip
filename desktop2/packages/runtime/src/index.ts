import {
  createAgentModules,
  type EngineControlBridge,
  type EngineTokenMap,
} from "@dramaip/agents";
import { automationModule } from "@dramaip/automation";
import { creativeQualityModule } from "@dramaip/creative-quality";
import { deliveryModule } from "@dramaip/delivery";
import { createFoundationModule } from "@dramaip/foundation";
import { insightsModule } from "@dramaip/insights";
import {
  bootServerKernel,
  parseProfileText,
  type RunningKernel,
} from "@dramaip/kernel";
import { knowledgeModule } from "@dramaip/knowledge";
import { mediaModule } from "@dramaip/media";
import type {
  DramaPluginExports,
  MigrationDefinition,
} from "@dramaip/plugin-api";
import { productionModule } from "@dramaip/production";
import { reviewModule } from "@dramaip/review";
import { createSystemModule } from "@dramaip/system";
import { timelineModule } from "@dramaip/timeline";
import {
  createWorkspaceModule,
  type FileCapabilityResolver,
} from "@dramaip/workspace";
import { writingModule } from "@dramaip/writing";

export * from "./parent-port-bridge.ts";

export const builtinPluginIds = [
  "foundation",
  "system",
  "workspace",
  "writing",
  "knowledge",
  "automation",
  "agents",
  "engine-opencode",
  "engine-codex",
  "engine-dsh",
  "engine-pi",
  "engine-langgraph",
  "production",
  "creative-quality",
  "media",
  "timeline",
  "review",
  "delivery",
  "insights",
] as const;

export interface DramaRuntimeConfig {
  profileText: string;
  databaseFile: string;
  backupDirectory: string;
  username: string;
  password: string;
  allowedOrigins: readonly string[];
  engineBridge: EngineControlBridge;
  engineTokens: EngineTokenMap;
  fileCapabilityResolver?: FileCapabilityResolver;
}

export interface PreparedDramaRuntime {
  profile: ReturnType<typeof parseProfileText>;
  builtins: ReadonlyMap<string, DramaPluginExports<unknown>>;
}

function collectMigrations(
  modules: ReadonlyMap<string, DramaPluginExports<unknown>>,
  selectedIds: readonly string[],
): readonly MigrationDefinition[] {
  const migrations: MigrationDefinition[] = [];
  for (const id of selectedIds)
    migrations.push(...(modules.get(id)?.migrations ?? []));
  return migrations;
}

export function prepareDramaRuntime(
  config: DramaRuntimeConfig,
): PreparedDramaRuntime {
  const profile = parseProfileText(
    config.profileText,
    new Set(builtinPluginIds),
  );
  const agentModules = createAgentModules(
    config.engineBridge,
    config.engineTokens,
  );
  const workspaceModule = createWorkspaceModule(config.fileCapabilityResolver);
  const systemModule = createSystemModule({
    backupDirectory: config.backupDirectory,
    profileName: profile.name,
    pluginIds: profile.plugins.map((entry) => entry.id),
  });
  const modules = new Map<string, DramaPluginExports<unknown>>();
  for (const module of [
    systemModule,
    workspaceModule,
    writingModule,
    knowledgeModule,
    automationModule,
    ...agentModules,
    productionModule,
    creativeQualityModule,
    mediaModule,
    timelineModule,
    reviewModule,
    deliveryModule,
    insightsModule,
  ]) {
    modules.set(module.descriptor.id, module);
  }
  const migrations = collectMigrations(
    modules,
    profile.plugins.map((entry) => entry.id),
  );
  const foundation = createFoundationModule({
    databaseFile: config.databaseFile,
    backupDirectory: config.backupDirectory,
    migrations,
    http: {
      username: config.username,
      password: config.password,
      allowedOrigins: config.allowedOrigins,
      internalBearerPath: "/api/v2/agents/mcp",
      internalBearerTokens: Object.values(config.engineTokens),
    },
  });
  modules.set("foundation", foundation);
  return { profile, builtins: modules };
}

export async function bootDramaRuntime(
  config: DramaRuntimeConfig,
): Promise<RunningKernel> {
  const prepared = prepareDramaRuntime(config);
  return bootServerKernel(prepared);
}
