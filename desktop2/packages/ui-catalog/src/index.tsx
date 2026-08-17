import type { Plugin } from "@deepseek-ai/cordis";

import { agentsUi } from "@dramaip/agents/ui";
import { creativeQualityUi } from "@dramaip/creative-quality/ui";
import { deliveryUi } from "@dramaip/delivery/ui";
import { insightsUi } from "@dramaip/insights/ui";
import { mediaUi } from "@dramaip/media/ui";
import type {
  DramaPluginExports,
  PluginProfile,
  UiContribution,
} from "@dramaip/plugin-api";
import { systemUi } from "@dramaip/system/ui";
import { productionUi } from "@dramaip/production/ui";
import { reviewUi } from "@dramaip/review/ui";
import { timelineUi } from "@dramaip/timeline/ui";
import { UiRegistryService } from "@dramaip/ui-runtime";
import { workspaceUi } from "@dramaip/workspace/ui";
import { writingUi } from "@dramaip/writing/ui";
import { knowledgeUi } from "@dramaip/knowledge/ui";
import { automationUi } from "@dramaip/automation/ui";

const contributions: Readonly<Record<string, readonly UiContribution[]>> = {
  system: systemUi,
  workspace: workspaceUi,
  automation: automationUi,
  writing: writingUi,
  knowledge: knowledgeUi,
  "creative-quality": creativeQualityUi,
  agents: agentsUi,
  production: productionUi,
  media: mediaUi,
  timeline: timelineUi,
  review: reviewUi,
  delivery: deliveryUi,
  insights: insightsUi,
};

export const rendererProfile: PluginProfile = {
  name: "studio",
  plugins: [
    { id: "foundation" },
    { id: "system" },
    { id: "workspace" },
    { id: "automation" },
    { id: "writing" },
    { id: "knowledge" },
    { id: "creative-quality" },
    { id: "agents" },
    { id: "production" },
    { id: "media" },
    { id: "timeline" },
    { id: "review" },
    { id: "delivery" },
    { id: "insights" },
  ],
};

function uiModule(id: string, values: readonly UiContribution[]): Plugin {
  return {
    name: `dramaip-ui-${id}`,
    inject: ["uiRegistry"],
    apply(ctx) {
      ctx.uiRegistry.register(values);
    },
  };
}

export function createRendererCatalog(): {
  descriptors: ReadonlyMap<string, DramaPluginExports<unknown>>;
  modules: ReadonlyMap<string, { plugin: Plugin }>;
} {
  const descriptors = new Map<string, DramaPluginExports<unknown>>();
  const modules = new Map<string, { plugin: Plugin }>();
  descriptors.set("foundation", {
    descriptor: {
      id: "foundation",
      version: "1.0.0",
      runtime: "renderer",
      requires: [],
      provides: ["uiRegistry"],
      critical: true,
    },
    contracts: {},
  });
  modules.set("foundation", {
    plugin: {
      name: "renderer-foundation",
      provide: "uiRegistry",
      apply(ctx) {
        new UiRegistryService(ctx);
      },
    },
  });
  for (const entry of rendererProfile.plugins.slice(1)) {
    const values = contributions[entry.id] ?? [];
    descriptors.set(entry.id, {
      descriptor: {
        id: entry.id,
        version: "2.0.0",
        runtime: "renderer",
        requires: ["foundation"],
        provides: [`ui.${entry.id}`],
        critical: true,
      },
      contracts: {},
      ui: values,
    });
    modules.set(entry.id, { plugin: uiModule(entry.id, values) });
  }
  return { descriptors, modules };
}
