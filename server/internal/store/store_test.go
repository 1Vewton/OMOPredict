package store

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

// TestGORMLoggerUsesConfiguredWriter GORM 日志必须走配置的 writer。
//
// 回归背景：GORM 默认写 stdout；在 stdio JSON-RPC 模式下 stdout 是协议流，
// SQL 日志混入会破坏 JSON-Lines（实测导致 tasks.get 响应被日志行挤掉）。
func TestGORMLoggerUsesConfiguredWriter(t *testing.T) {
	var buf bytes.Buffer
	db, err := Open(Config{
		Driver:    DriverSQLite,
		DSN:       filepath.Join(t.TempDir(), "log.db"),
		LogWriter: &buf,
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	type probe struct {
		ID string `gorm:"primaryKey"`
	}
	if err := Migrate(db, &probe{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var p probe
	// 触发 GORM Warn 级日志（record not found）
	_ = db.First(&p, "id = ?", "missing").Error
	sqlDB, _ := db.DB()
	_ = sqlDB.Close()

	if !strings.Contains(buf.String(), "record not found") {
		t.Fatalf("GORM 日志未写入配置的 writer：%q", buf.String())
	}
}

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
