package com.dramaip.platform.migration;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.migration")
public class MigrationProperties {
    private Path legacyMigrationsDir = Path.of("../legacy/go-services/migrations");
    private boolean roleBootstrap;
    private boolean applyPendingLegacyMigrations;
    private String rolePassword = "";

    public Path getLegacyMigrationsDir() { return legacyMigrationsDir; }
    public void setLegacyMigrationsDir(Path legacyMigrationsDir) { this.legacyMigrationsDir = legacyMigrationsDir; }
    public boolean isRoleBootstrap() { return roleBootstrap; }
    public void setRoleBootstrap(boolean roleBootstrap) { this.roleBootstrap = roleBootstrap; }
    public boolean isApplyPendingLegacyMigrations() { return applyPendingLegacyMigrations; }
    public void setApplyPendingLegacyMigrations(boolean applyPendingLegacyMigrations) {
        this.applyPendingLegacyMigrations = applyPendingLegacyMigrations;
    }
    public String getRolePassword() { return rolePassword; }
    public void setRolePassword(String rolePassword) { this.rolePassword = rolePassword; }
}
