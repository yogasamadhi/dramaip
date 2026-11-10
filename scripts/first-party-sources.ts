import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import type { FirstPartyPlugin } from "@dramaip/plugin-api/internal";
import type { DesktopHost } from "@dramaip/host-contracts";
import { createAgentsPlugin } from "../packages/agents/agents/handlers/agents/index.js";
import { automationPlugin } from "../packages/automation/automation/handlers/automation/index.js";
import { creativeQualityPlugin } from "../packages/writing/quality/handlers/creative-quality/index.js";
import { deliveryPlugin } from "../packages/production/delivery/handlers/delivery/index.js";
import { createFoundationPlugin } from "../packages/system/system/handlers/foundation/index.js";
import { createInsightsPlugin } from "../packages/insights/insights/handlers/insights/index.js";
import { createKnowledgePlugin } from "../packages/writing/knowledge/handlers/knowledge/index.js";
import { createMediaPlugin } from "../packages/production/media/handlers/media/index.js";
import { createProductionPlugin } from "../packages/production/production/handlers/production/index.js";
import { createReviewPlugin } from "../packages/production/review/handlers/review/index.js";
import { createSystemPlugin } from "../packages/system/system/handlers/system/index.js";
import { createTimelinePlugin } from "../packages/production/timeline/handlers/timeline/index.js";
import { createWorkspacePlugin } from "../packages/workspace/workspace/handlers/workspace/index.js";
import { writingPlugin } from "../packages/writing/writing/handlers/writing/index.js";

export interface FirstPartyPluginRegistryOptions {
  readonly host?: DesktopHost;
  readonly maintenance?: DatabaseMaintenanceService;
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
    createSystemPlugin(options.host),
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
