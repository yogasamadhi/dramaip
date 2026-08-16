import type { Plugin } from "@deepseek-ai/cordis";

import { DatabaseRuntime, UnitOfWorkService } from "@dramaip/database";
import { EventRuntimeService } from "@dramaip/events";
import { HttpHostService, type HttpHostConfig } from "@dramaip/http";
import {
  defineDramaPlugin,
  type DramaPluginExports,
  type MigrationDefinition,
} from "@dramaip/plugin-api";
import { UiRegistryService } from "@dramaip/ui-runtime";

export interface FoundationRuntimeConfig {
  databaseFile: string;
  backupDirectory?: string;
  migrations: readonly MigrationDefinition[];
  http: HttpHostConfig;
}

export function createFoundationModule(
  config: FoundationRuntimeConfig,
): DramaPluginExports<unknown> {
  const server: Plugin = {
    name: "dramaip-foundation",
    provide: ["database", "uow", "eventRuntime", "http"],
    apply(ctx) {
      const database = new DatabaseRuntime(ctx, {
        filename: config.databaseFile,
        backupDirectory: config.backupDirectory,
        migrations: config.migrations,
      });
      const uow = new UnitOfWorkService(ctx, database);
      new EventRuntimeService(ctx, uow);
      new HttpHostService(ctx, config.http);
    },
  };
  return defineDramaPlugin({
    descriptor: {
      id: "foundation",
      version: "1.0.0",
      runtime: "server",
      requires: [],
      provides: ["database", "uow", "eventRuntime", "http"],
      critical: true,
    },
    contracts: {},
    server,
    migrations: [],
  });
}

export const rendererFoundation: Plugin = {
  name: "dramaip-renderer-foundation",
  provide: "uiRegistry",
  apply(ctx) {
    new UiRegistryService(ctx);
  },
};
