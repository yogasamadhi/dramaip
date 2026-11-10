import { defineServiceContract } from "./service-contract.js";

export const FOUNDATION_DATABASE_MAINTENANCE_SERVICE =
  defineServiceContract<DatabaseMaintenanceService>({
    id: "foundation.database-maintenance.v1",
    owner: "foundation",
    major: 1,
    capabilities: ["backup", "restore"],
    degradable: true,
  });

export interface DatabaseBackupSnapshot {
  fileName: string;
  size: number;
  sha256: string;
  createdAt: string;
}

/** Runtime-adapter capability. Plugins never receive an absolute database path. */
export interface DatabaseMaintenanceService {
  createBackup(): DatabaseBackupSnapshot;
  restoreBackup(fileName: string, expectedSha256: string): void;
}
