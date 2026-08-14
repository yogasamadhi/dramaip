package com.dramaip.platform.migration;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.migration")
public class MigrationProperties {
    private Path historicalMigrationsDir = Path.of("migration/historical-migrations");
    private boolean roleBootstrap;
    private boolean applyPendingHistoricalMigrations;
    private String rolePassword = "";

    public Path getHistoricalMigrationsDir() { return historicalMigrationsDir; }
    public void setHistoricalMigrationsDir(Path historicalMigrationsDir) { this.historicalMigrationsDir = historicalMigrationsDir; }
    public boolean isRoleBootstrap() { return roleBootstrap; }
    public void setRoleBootstrap(boolean roleBootstrap) { this.roleBootstrap = roleBootstrap; }
    public boolean isApplyPendingHistoricalMigrations() { return applyPendingHistoricalMigrations; }
    public void setApplyPendingHistoricalMigrations(boolean applyPendingHistoricalMigrations) {
        this.applyPendingHistoricalMigrations = applyPendingHistoricalMigrations;
    }
    public String getRolePassword() { return rolePassword; }
    public void setRolePassword(String rolePassword) { this.rolePassword = rolePassword; }
}
