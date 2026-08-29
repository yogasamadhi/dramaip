package com.dramaip.platform.migration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.nio.file.Path;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

class MigrationRunnerTest {
    @Test
    void propertiesRoundTripAndRoleBootstrapRequiresAnExplicitPassword() {
        MigrationProperties properties = new MigrationProperties();
        Path migrations = Path.of("build/test-migrations");
        properties.setHistoricalMigrationsDir(migrations);
        properties.setApplyPendingHistoricalMigrations(true);
        properties.setRoleBootstrap(true);
        properties.setRolePassword("");

        assertEquals(migrations, properties.getHistoricalMigrationsDir());
        assertTrue(properties.isApplyPendingHistoricalMigrations());
        assertTrue(properties.isRoleBootstrap());
        assertEquals("", properties.getRolePassword());

        MigrationRunner runner = new MigrationRunner(mock(DataSource.class), properties);
        IllegalStateException failure = assertThrows(
                IllegalStateException.class,
                () -> runner.run(new DefaultApplicationArguments())
        );
        assertTrue(failure.getMessage().contains("ROLE_PASSWORD"));

        properties.setApplyPendingHistoricalMigrations(false);
        properties.setRoleBootstrap(false);
        assertFalse(properties.isApplyPendingHistoricalMigrations());
        assertFalse(properties.isRoleBootstrap());
    }
}
