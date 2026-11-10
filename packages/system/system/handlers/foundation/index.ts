import { provideService } from "@dramaip/plugin-api/internal";
import { foundationMigrations } from "@dramaip/database";
import {
  FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
  type DatabaseMaintenanceService,
} from "@dramaip/contracts/foundation";
import { definePlugin } from "@dramaip/plugin-api/internal";

export function createFoundationPlugin(
  maintenance?: DatabaseMaintenanceService,
) {
  return definePlugin({
    descriptor: {
      id: "foundation",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: [],
      provides: [FOUNDATION_DATABASE_MAINTENANCE_SERVICE.id],
      stability: "internal",
    },
    migrations: foundationMigrations,
    apply: (context) => {
      if (maintenance)
        context.effect(
          () =>
            provideService(
              context,
              FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
              maintenance,
            ),
          `service:${FOUNDATION_DATABASE_MAINTENANCE_SERVICE}`,
        );
    },
  });
}

export const foundationPlugin = createFoundationPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "foundation-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createFoundationPlugin(
        ctx.pluginEnvironment.maintenance as Parameters<
          typeof createFoundationPlugin
        >[0],
      ),
      config,
    );
  },
};
