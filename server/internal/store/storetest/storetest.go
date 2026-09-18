// Package storetest 为测试提供数据库构造工具（进程内私有内存 SQLite）。
//
// 为什么不用临时文件：每条用例都新建文件 + AutoMigrate 是本项目测试的主要固定开销
// （沙箱/CI 的文件 I/O 尤其明显），内存库无落盘、无文件锁，也不受 Windows 文件锁影响。
// 文件 DSN 的生产行为由 internal/store 自身的测试保障（TestOpenSQLiteAndMigrate、
// TestOpenMemorySQLite），业务包测试只关心模型与逻辑。
package storetest

import (
	"testing"

	"github.com/1Vewton/OMOPredict/server/internal/store"
	"gorm.io/gorm"
)

// OpenMemory 打开一个测试专用的内存 SQLite，并自动迁移给定模型。
//
// 注意：SQLite 内存库是"每连接一个数据库"，因此连接池固定为**单连接**
// （MaxOpenConns=1、MaxIdleConns=1，且不设连接超时）——否则不同连接会看到不同的空库，
// 出现 `no such table` 之类的随机失败。
//
// 连接池在测试结束时自动关闭（t.Cleanup）。
func OpenMemory(t testing.TB, models ...any) *gorm.DB {
	t.Helper()
	db, err := store.Open(store.Config{Driver: store.DriverSQLite, DSN: ":memory:"})
	if err != nil {
		t.Fatalf("storetest: open memory sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("storetest: get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(0)
	sqlDB.SetConnMaxIdleTime(0)

	if len(models) > 0 {
		if err := store.Migrate(db, models...); err != nil {
			t.Fatalf("storetest: migrate: %v", err)
		}
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
