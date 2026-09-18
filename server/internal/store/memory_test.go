package store

import (
	"testing"
)

// TestOpenMemorySQLite 守护 storetest 依赖的前提：`:memory:` DSN 可用，
// 且连接池限制为单连接时不会丢表（内存库是"每连接一个数据库"）。
func TestOpenMemorySQLite(t *testing.T) {
	t.Parallel()
	db, err := Open(Config{Driver: DriverSQLite, DSN: ":memory:"})
	if err != nil {
		t.Fatalf("open memory sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// 内存库是每连接一个数据库：连接池必须限制为单连接
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	type probe struct {
		ID   string `gorm:"primaryKey"`
		Name string
	}
	if err := Migrate(db, &probe{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&probe{ID: "a", Name: "x"}).Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	var got probe
	if err := db.First(&got, "id = ?", "a").Error; err != nil {
		t.Fatalf("first: %v", err)
	}
	if got.Name != "x" {
		t.Fatalf("got %+v", got)
	}
	// 反复访问，确认单连接下不会丢表
	for i := 0; i < 5; i++ {
		var n int64
		if err := db.Model(&probe{}).Count(&n).Error; err != nil {
			t.Fatalf("count #%d: %v", i, err)
		}
		if n != 1 {
			t.Fatalf("count #%d = %d, want 1", i, n)
		}
	}
}
