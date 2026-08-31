package store

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv("OMO_DB_DRIVER", DriverMySQL)
	t.Setenv("OMO_DB_DSN", "user:pass@tcp(127.0.0.1:3306)/db")
	cfg := LoadConfig()
	if cfg.Driver != DriverMySQL || cfg.DSN != "user:pass@tcp(127.0.0.1:3306)/db" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("OMO_DB_DRIVER", "")
	t.Setenv("OMO_DB_DSN", "")
	cfg := LoadConfig()
	if cfg.Driver != DriverSQLite || cfg.DSN != "omopredict.db" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestOpenSQLiteAndMigrate(t *testing.T) {
	db, err := Open(Config{Driver: DriverSQLite, DSN: filepath.Join(t.TempDir(), "t.db")})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	type probe struct {
		ID uint `gorm:"primaryKey"`
	}
	if err := Migrate(db, &probe{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var count int64
	if err := db.Model(&probe{}).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("count = %d, want 0", count)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	_ = sqlDB.Close()
}

func TestOpenUnsupportedDriver(t *testing.T) {
	if _, err := Open(Config{Driver: "oracle", DSN: "x"}); err == nil {
		t.Fatal("unsupported driver should error")
	}
}
