// Package store 提供数据库连接（GORM）与配置加载（.env）。
//
// 支持 SQLite（纯 Go 驱动）/ MySQL / PostgreSQL：OMO_DB_DRIVER 选择方言，
// OMO_DB_DSN 提供连接串（可写在 server/.env 或环境变量中）。
package store

import (
	"fmt"
	"os"

	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// 支持的数据库驱动。
const (
	DriverSQLite   = "sqlite"
	DriverMySQL    = "mysql"
	DriverPostgres = "postgres"
)

// Config 数据库配置。
type Config struct {
	Driver string // sqlite | mysql | postgres
	DSN    string // 连接串
}

// LoadConfig 从 .env（可选，缺失不报错）与环境变量读取配置。
//
// 优先级：真实环境变量 > .env 文件 > 默认值（sqlite / omopredict.db）。
// godotenv.Load 不会覆盖已存在的环境变量，因此进程环境优先。
func LoadConfig() Config {
	_ = godotenv.Load()
	return Config{
		Driver: envOr("OMO_DB_DRIVER", DriverSQLite),
		DSN:    envOr("OMO_DB_DSN", "omopredict.db"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Open 按驱动打开 GORM 连接。
//
// 异常:
//   - 不支持的驱动（须为 sqlite | mysql | postgres）
//   - 数据库初始化失败
func Open(cfg Config) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch cfg.Driver {
	case DriverSQLite:
		dialector = sqlite.Open(cfg.DSN)
	case DriverMySQL:
		dialector = mysql.Open(cfg.DSN)
	case DriverPostgres:
		dialector = postgres.Open(cfg.DSN)
	default:
		return nil, fmt.Errorf(
			"store: unsupported driver %q (sqlite|mysql|postgres)", cfg.Driver,
		)
	}
	// TranslateError: 让驱动把唯一约束等错误翻译为 gorm 哨兵
	// （如 ErrDuplicatedKey），供上层 errors.Is 判定。
	db, err := gorm.Open(dialector, &gorm.Config{TranslateError: true})
	if err != nil {
		return nil, fmt.Errorf("store: open %s: %w", cfg.Driver, err)
	}
	return db, nil
}

// Migrate 执行模型自动迁移（建表 / 加列）。
func Migrate(db *gorm.DB, models ...any) error {
	return db.AutoMigrate(models...)
}

// Close 关闭底层数据库连接池。
//
// 注意：database/sql 的连接池不会自动关闭——池的生命周期等于 *sql.DB
// 对象本身，必须显式 Close（查询连接只是归还池，池仍持有文件句柄）。
func Close(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("store: get sql db: %w", err)
	}
	return sqlDB.Close()
}
