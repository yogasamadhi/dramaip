package platform

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"gorm.io/gorm"
)

var migrationFilePattern = regexp.MustCompile(`^([0-9]+)_.+\.up\.sql$`)

type migrationFile struct {
	Version uint
	Path    string
}

func RunMigrations(db *gorm.DB, root string) error {
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
	sourceURL, err := migrationSourceURL(root)
	if err != nil {
		return err
	}

	conn, err := sqlDB.Conn(context.Background())
	if err != nil {
		return err
	}
	driver, err := postgres.WithConnection(context.Background(), conn, &postgres.Config{})
	if err != nil {
		_ = conn.Close()
		return err
	}
	runner, err := migrate.NewWithDatabaseInstance(sourceURL, "postgres", driver)
	if err != nil {
		_ = driver.Close()
		return err
	}
	defer runner.Close()

	if err := runner.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}
	return nil
}

func scanMigrationFiles(root string) ([]migrationFile, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	seen := map[uint]string{}
	files := make([]migrationFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		match := migrationFilePattern.FindStringSubmatch(name)
		if match == nil {
			return nil, fmt.Errorf("invalid migration filename %q: expected {version}_{name}.up.sql", name)
		}
		version64, err := strconv.ParseUint(match[1], 10, 32)
		if err != nil {
			return nil, fmt.Errorf("invalid migration version in %q: %w", name, err)
		}
		version := uint(version64)
		if previous, ok := seen[version]; ok {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s", version, previous, name)
		}
		seen[version] = name
		files = append(files, migrationFile{Version: version, Path: filepath.Join(root, name)})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Version < files[j].Version
	})
	return files, nil
}

func migrationSourceURL(root string) (string, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String(), nil
}
