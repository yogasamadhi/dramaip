package com.dramaip.platform.migration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Owns the one-way hand-off from the Go 001-049 ledger to Flyway. */
@Component
class MigrationRunner implements ApplicationRunner {
    private static final Pattern LEGACY_FILE = Pattern.compile("^(\\d{3})_.+\\.up\\.sql$");
    private static final int LEGACY_BASELINE = 49;
    private final DataSource dataSource;
    private final MigrationProperties properties;

    MigrationRunner(DataSource dataSource, MigrationProperties properties) {
        this.dataSource = dataSource;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (properties.isRoleBootstrap()) bootstrapRoles();
        Flyway flyway = Flyway.configure().dataSource(dataSource).defaultSchema("public")
                .table("flyway_schema_history").locations("classpath:db/migration")
                .baselineVersion("49").baselineDescription("legacy-go-001-049")
                .baselineOnMigrate(false).load();
        if (flyway.info().current() != null) {
            flyway.migrate();
            return;
        }
        boolean legacyLedgerExists = legacyLedgerExists();
        if (!legacyLedgerExists || properties.isApplyPendingLegacyMigrations()) {
            if (legacyLedgerExists) verifyLegacyLedgerPrefix();
            applyLegacyMigrations();
        }
        verifyLegacyLedger();
        flyway.baseline();
        flyway.migrate();
    }

    private boolean legacyLedgerExists() throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
                "select to_regclass('public.schema_migrations') is not null"); ResultSet result = statement.executeQuery()) {
            result.next();
            return result.getBoolean(1);
        }
    }

    private void verifyLegacyLedger() throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
                "select count(*), coalesce(min(version), 0), coalesce(max(version), 0), coalesce(bool_or(dirty), false) from public.schema_migrations"); ResultSet result = statement.executeQuery()) {
            result.next();
            if (result.getLong(1) != LEGACY_BASELINE || result.getLong(2) != 1 || result.getLong(3) != LEGACY_BASELINE || result.getBoolean(4)) {
                throw new IllegalStateException("legacy schema_migrations must be clean and contiguous at 001-049 before Flyway baseline");
            }
        }
    }

    private void verifyLegacyLedgerPrefix() throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
                "select count(*), coalesce(min(version), 0), coalesce(max(version), 0), coalesce(bool_or(dirty), false) from public.schema_migrations"); ResultSet result = statement.executeQuery()) {
            result.next();
            long count = result.getLong(1);
            long minimum = result.getLong(2);
            long maximum = result.getLong(3);
            if ((count > 0 && minimum != 1) || count != maximum || maximum > LEGACY_BASELINE || result.getBoolean(4)) {
                throw new IllegalStateException("legacy schema_migrations must be a clean, contiguous prefix of 001-049 before local resume");
            }
        }
    }

    private void applyLegacyMigrations() throws IOException, SQLException {
        Path root = properties.getLegacyMigrationsDir().toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) throw new IllegalStateException("legacy migrations directory is required for an empty database: " + root);
        List<LegacyMigration> migrations;
        try (var paths = Files.walk(root)) {
            migrations = paths.filter(Files::isRegularFile)
                    .filter(path -> LEGACY_FILE.matcher(path.getFileName().toString()).matches())
                    .map(this::legacyMigration).sorted(Comparator.comparingInt(LegacyMigration::version)).toList();
        }
        if (migrations.size() != LEGACY_BASELINE || migrations.getFirst().version() != 1
                || migrations.getLast().version() != LEGACY_BASELINE
                || migrations.stream().mapToInt(LegacyMigration::version).distinct().count() != LEGACY_BASELINE) {
            throw new IllegalStateException("legacy migration files must contain exactly one forward migration for every version 001-049");
        }
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("create table if not exists public.schema_migrations (version bigint primary key, dirty boolean not null default false)");
            for (LegacyMigration migration : migrations) {
                if (alreadyApplied(connection, migration.version())) continue;
                connection.setAutoCommit(false);
                try {
                    statement.execute(Files.readString(migration.path()));
                    try (PreparedStatement record = connection.prepareStatement("insert into public.schema_migrations(version, dirty) values (?, false) on conflict(version) do update set dirty = false")) {
                        record.setInt(1, migration.version());
                        record.executeUpdate();
                    }
                    connection.commit();
                } catch (SQLException | IOException exception) {
                    connection.rollback();
                    throw exception;
                } finally {
                    connection.setAutoCommit(true);
                }
            }
        }
    }

    private boolean alreadyApplied(Connection connection, int version) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("select dirty from public.schema_migrations where version = ?")) {
            statement.setInt(1, version);
            try (ResultSet result = statement.executeQuery()) { return result.next() && !result.getBoolean(1); }
        }
    }

    private LegacyMigration legacyMigration(Path path) {
        Matcher matcher = LEGACY_FILE.matcher(path.getFileName().toString());
        if (!matcher.matches()) throw new IllegalArgumentException("invalid legacy migration filename: " + path);
        return new LegacyMigration(Integer.parseInt(matcher.group(1)), path);
    }

    private void bootstrapRoles() throws SQLException {
        if (properties.getRolePassword().isBlank()) throw new IllegalStateException("DRAMAIP_MIGRATION_ROLE_PASSWORD is required when role bootstrap is enabled");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            for (String role : List.of("dramaip_auth", "dramaip_user", "dramaip_billing", "dramaip_quota", "dramaip_ai_gateway", "dramaip_notification", "dramaip_inspiration", "dramaip_admin", "dramaip_reporting", "dramaip_snapshot", "dramaip_review", "dramaip_identity_svc", "dramaip_support_svc", "dramaip_creation_svc", "dramaip_quota_svc", "dramaip_ai_svc", "dramaip_billing_svc")) {
                statement.execute("do $$ begin if not exists (select 1 from pg_roles where rolname = '" + role + "') then create role " + role + " login nosuperuser nocreatedb nocreaterole noinherit password '" + quote(properties.getRolePassword()) + "'; else alter role " + role + " login nosuperuser nocreatedb nocreaterole noinherit password '" + quote(properties.getRolePassword()) + "'; end if; end $$");
            }
        }
    }

    private String quote(String value) { return value.replace("'", "''"); }
    private record LegacyMigration(int version, Path path) { }
}
