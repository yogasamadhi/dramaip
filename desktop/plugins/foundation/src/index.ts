import { foundationMigrations } from "@dramaip/database";
import {
  FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
  type DatabaseMaintenanceService,
} from "@dramaip/contracts/foundation";
import { defineFirstPartyPlugin } from "@dramaip/plugin-api/internal";

export function createFoundationPlugin(
  maintenance?: DatabaseMaintenanceService,
) {
  return defineFirstPartyPlugin({
    descriptor: {
      id: "foundation",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: [],
      provides: maintenance ? [FOUNDATION_DATABASE_MAINTENANCE_SERVICE] : [],
      stability: "internal",
    },
    migrations: foundationMigrations,
    activate: (context) => {
      if (maintenance)
        context.effect(
          context.services.provide(
            FOUNDATION_DATABASE_MAINTENANCE_SERVICE,
            maintenance,
          ),
          `service:${FOUNDATION_DATABASE_MAINTENANCE_SERVICE}`,
        );
    },
  });
}

export const foundationPlugin = createFoundationPlugin();
