/**
 * Relational storage backend (D1): one `node:sqlite` database holding the
 * relational domains. Every domain owner declares its immutable forward
 * migrations before it writes; writes commit through the shared unit of
 * work, one transaction each.
 *
 * Declarations accumulate. Each one plans the union of every migration
 * declared so far, so a migration may depend on migrations of the domains
 * its owner already depends on. Pending migrations of a database that held
 * tables when it was opened run after a verified backup and a dry run on a
 * copy; a database created by this process has no earlier state to protect.
 * @module @dramaip/infra-storage-relational
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { dirname, join } from "node:path";
import {
  listAppliedMigrations,
  openDatabase,
  runMigrationPlan,
  type AppliedMigrationDiagnostic,
  type DatabaseHandle,
  type MigrationRunDiagnostic,
} from "@dramaip/database";
import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import type { PluginMigration, UnitOfWork } from "@dramaip/plugin-api/internal";

/** Cordis plugin name. */
export const name = "storage-relational";

/** Plugin configuration. */
export interface Config {
  /** Database file; `:memory:` opens an in-process database (tests). */
  path: string;
  /** Pre-migration backups; defaults to `backups` next to the database. */
  backupDirectory?: string;
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  backupDirectory: z.string(),
});

/** One accepted declaration and the migration run it caused. */
export interface RelationalDeclaration {
  readonly owner: string;
  readonly migrations: readonly string[];
  readonly run: MigrationRunDiagnostic;
}

/** The `relationalStorage` service. */
export interface RelationalStorage {
  readonly path: string;
  /**
   * The open connection, for maintenance tools and test fixtures that read
   * or seed tables directly. Domain owners write through `uow`.
   */
  readonly database: DatabaseHandle;
  /**
   * Declare an owner's migrations and apply the pending ones. Declaring the
   * same set again is a no-op; a different set for a declared owner fails,
   * because migrations are immutable for the life of the process.
   * @param owner - domain owner; every migration must name it.
   * @param migrations - the owner's complete forward migration list.
   */
  declare(
    owner: string,
    migrations: readonly PluginMigration[],
  ): MigrationRunDiagnostic;
  /** Accepted declarations, in acceptance order. */
  declarations(): readonly RelationalDeclaration[];
  /** The migration ledger as stored. */
  applied(): readonly AppliedMigrationDiagnostic[];
  /** Backup and restore of the whole database file. */
  maintenance(): DatabaseMaintenanceService;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    relationalStorage: RelationalStorage;
  }
}

const idsOf = (migrations: readonly PluginMigration[]): string[] =>
  migrations.map((migration) => migration.id).sort();

class SqliteRelationalStorage implements RelationalStorage {
  private readonly declared = new Map<string, readonly PluginMigration[]>();
  private readonly accepted: RelationalDeclaration[] = [];

  constructor(
    readonly path: string,
    private readonly backupDirectory: string,
    readonly database: DatabaseHandle,
    private readonly openedWithState: boolean,
  ) {}

  declare(
    owner: string,
    migrations: readonly PluginMigration[],
  ): MigrationRunDiagnostic {
    for (const migration of migrations)
      if (migration.pluginId !== owner)
        throw new Error(
          `storage-relational: migration ${migration.id} declares ${migration.pluginId}, not ${owner}`,
        );
    const previous = this.declared.get(owner);
    if (previous) {
      if (idsOf(previous).join("\n") !== idsOf(migrations).join("\n"))
        throw new Error(
          `storage-relational: ${owner} changed its migrations; restart to migrate`,
        );
      return this.accepted.find((entry) => entry.owner === owner)!.run;
    }
    const run = runMigrationPlan(
      this.database,
      [...[...this.declared.values()].flat(), ...migrations],
      {
        databasePath: this.path,
        backupDirectory: this.backupDirectory,
        protectExistingState: this.openedWithState,
      },
    );
    this.declared.set(owner, migrations);
    this.accepted.push({ owner, migrations: idsOf(migrations), run });
    return run;
  }

  declarations(): readonly RelationalDeclaration[] {
    return [...this.accepted];
  }

  applied(): readonly AppliedMigrationDiagnostic[] {
    return listAppliedMigrations(this.database.sqlite);
  }

  maintenance(): DatabaseMaintenanceService {
    return this.database.maintenance(this.backupDirectory);
  }
}

/**
 * Open the database and provide `relationalStorage` and `uow`; the fiber's
 * disposal closes the connection after both services are withdrawn.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const database = openDatabase(config.path);
  ctx.effect(
    () => () => database.close(),
    "storage-relational: database connection",
  );
  const backupDirectory =
    config.backupDirectory ?? join(dirname(config.path), "backups");
  const openedWithState = Boolean(
    database.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
      .get(),
  );
  const storage = new SqliteRelationalStorage(
    config.path,
    backupDirectory,
    database,
    openedWithState,
  );
  ctx.provide("relationalStorage", storage);
  ctx.provide("uow", database.uow satisfies UnitOfWork);
}
