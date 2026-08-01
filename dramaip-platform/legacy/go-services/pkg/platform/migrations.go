package platform

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

var migrationFilePattern = regexp.MustCompile(`^([0-9]+)_.+\.up\.sql$`)

type migrationFile struct {
	Version uint
	Path    string
}

func RunMigrations(db *gorm.DB, root string) error {
	if err := BootstrapDatabaseRoles(context.Background(), db); err != nil {
		return fmt.Errorf("bootstrap database roles: %w", err)
	}
	files, err := scanMigrationFiles(root)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}

	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return runMigrationFiles(context.Background(), sqlDB, files)
}

func scanMigrationFiles(root string) ([]migrationFile, error) {
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	seen := map[uint]string{}
	files := []migrationFile{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".up.sql") {
			return nil
		}
		match := migrationFilePattern.FindStringSubmatch(name)
		if match == nil {
			return fmt.Errorf("invalid migration filename %q: expected {version}_{name}.up.sql", name)
		}
		version64, err := strconv.ParseUint(match[1], 10, 32)
		if err != nil {
			return fmt.Errorf("invalid migration version in %q: %w", name, err)
		}
		version := uint(version64)
		if previous, ok := seen[version]; ok {
			return fmt.Errorf("duplicate migration version %d: %s and %s", version, previous, path)
		}
		seen[version] = path
		files = append(files, migrationFile{Version: version, Path: path})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Version < files[j].Version
	})
	return files, nil
}

func runMigrationFiles(ctx context.Context, db *sql.DB, files []migrationFile) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version BIGINT PRIMARY KEY, dirty BOOLEAN NOT NULL DEFAULT false)`); err != nil {
		return err
	}
	for _, file := range files {
		var applied bool
		if err := db.QueryRowContext(ctx, `SELECT true FROM schema_migrations WHERE version = $1 AND dirty = false`, file.Version).Scan(&applied); err != nil && err != sql.ErrNoRows {
			return err
		}
		if applied {
			continue
		}
		raw, err := os.ReadFile(file.Path)
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(raw)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", file.Path, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, dirty) VALUES ($1, false) ON CONFLICT (version) DO UPDATE SET dirty = false`, file.Version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func migrationSourceURL(root string) (string, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String(), nil
}
