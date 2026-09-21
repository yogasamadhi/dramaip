import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import type { FirstPartyPlugin } from "@dramaip/plugin-api/internal";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createAgentsPlugin } from "../plugins/agents/src/index.js";
import { automationPlugin } from "../plugins/automation/src/index.js";
import { creativeQualityPlugin } from "../plugins/creative-quality/src/index.js";
import { deliveryPlugin } from "../plugins/delivery/src/index.js";
import { createFoundationPlugin } from "../plugins/foundation/src/index.js";
import { createInsightsPlugin } from "../plugins/insights/src/index.js";
import { createKnowledgePlugin } from "../plugins/knowledge/src/index.js";
import { createMediaPlugin } from "../plugins/media/src/index.js";
import { createProductionPlugin } from "../plugins/production/src/index.js";
import { createReviewPlugin } from "../plugins/review/src/index.js";
import { createSystemPlugin } from "../plugins/system/src/index.js";
import type { ExtensionPlatform } from "../plugins/system/src/index.js";
import { createTimelinePlugin } from "../plugins/timeline/src/index.js";
import { createWorkspacePlugin } from "../plugins/workspace/src/index.js";
import { writingPlugin } from "../plugins/writing/src/index.js";

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
