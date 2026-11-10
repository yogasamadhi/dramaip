/** First-party agents bounded-context composition entrypoint. */
export { createAgentsPlugin, agentsPlugin } from "./plugin.js";

import { createAgentsPlugin } from "./plugin.js";

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "agents-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createAgentsPlugin(
        ctx.pluginEnvironment.host as Parameters<typeof createAgentsPlugin>[0],
      ),
      config,
    );
  },
};
