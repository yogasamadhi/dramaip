import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { validatePluginGraph } from "@dramaip/kernel";
import { createAgentsPlugin } from "@dramaip/agents";
import { automationPlugin } from "@dramaip/automation";
import { creativeQualityPlugin } from "@dramaip/creative-quality";
import { deliveryPlugin } from "@dramaip/delivery";
import { createFoundationPlugin } from "@dramaip/foundation";
import { createInsightsPlugin } from "@dramaip/insights";
import { createKnowledgePlugin } from "@dramaip/knowledge";
import { createMediaPlugin } from "@dramaip/media";
import { createProductionPlugin } from "@dramaip/production";
import { createReviewPlugin } from "@dramaip/review";
import { createSystemPlugin } from "@dramaip/system";
import type { ExtensionPlatform } from "@dramaip/system";
import { createTimelinePlugin } from "@dramaip/timeline";
import { createWorkspacePlugin } from "@dramaip/workspace";
import { writingPlugin } from "@dramaip/writing";

export interface FirstPartyPluginRegistryOptions {
  readonly host?: DesktopHostClient;
  readonly maintenance?: DatabaseMaintenanceService;
  readonly extensionPlatform?: ExtensionPlatform;
}

/**
 * The single authoritative first-party plugin registry. Runtime boot,
 * architecture catalogs and conformance tests all consume this exact graph.
 */
export function createFirstPartyPluginRegistry(
  options: FirstPartyPluginRegistryOptions = {},
): ReadonlyMap<string, FirstPartyPlugin> {
  const plugins: FirstPartyPlugin[] = [
    createFoundationPlugin(options.maintenance),
    createSystemPlugin(options.host, options.extensionPlatform),
    createWorkspacePlugin(options.host),
    automationPlugin,
    writingPlugin,
    createKnowledgePlugin(options.host),
    createAgentsPlugin(options.host),
    creativeQualityPlugin,
    createProductionPlugin(options.host),
    createMediaPlugin(options.host),
    createTimelinePlugin(options.host),
    createReviewPlugin(options.host),
    deliveryPlugin,
    createInsightsPlugin(options.host),
  ];
  const registry = new Map(
    plugins.map((plugin) => [plugin.descriptor.id, plugin]),
  );
  if (registry.size !== plugins.length)
    throw new Error("duplicate first-party plugin id");
  return registry;
}

export function collectPluginMigrations(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
  profile: PluginProfile,
): readonly NonNullable<FirstPartyPlugin["migrations"]>[number][] {
  const migrations: NonNullable<FirstPartyPlugin["migrations"]>[number][] = [];
  for (const id of validatePluginGraph(plugins, profile)) {
    const plugin = plugins.get(id)!;
    for (const migration of plugin.migrations ?? []) {
      if (migration.pluginId !== id)
        throw new Error(
          `migration owner mismatch: ${migration.id} declares ${migration.pluginId}, expected ${id}`,
        );
      migrations.push(migration);
    }
  }
  return migrations;
}
