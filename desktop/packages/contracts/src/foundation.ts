export const FOUNDATION_DATABASE_MAINTENANCE_SERVICE =
  "foundation.database-maintenance.v1" as const;

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
