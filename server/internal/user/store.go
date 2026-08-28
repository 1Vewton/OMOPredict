// Package user 提供用户注册/登录与 JWT 认证（M3）。
package user

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// 存储错误哨兵。
var (
	ErrNotFound   = errors.New("user: not found")
	ErrUserExists = errors.New("user: already exists")
)

// Store 用户存储接口。
type Store interface {
	Create(ctx context.Context, u *User) error
	GetByID(ctx context.Context, id string) (*User, error)
	GetByUsername(ctx context.Context, username string) (*User, error)
	Close() error
}

// SQLiteStore 基于 SQLite 的用户存储（纯 Go 驱动 modernc.org/sqlite）。
type SQLiteStore struct {
	db *sql.DB
}

// OpenSQLiteStore 打开（不存在则创建）SQLite 数据库并建表。
func OpenSQLiteStore(path string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("user: open sqlite: %w", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			username      TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at    INTEGER NOT NULL
		)`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("user: create table: %w", err)
	}
	return &SQLiteStore{db: db}, nil
}

// Close 关闭数据库。
func (s *SQLiteStore) Close() error { return s.db.Close() }

// Create 插入用户；用户名重复返回 ErrUserExists。
func (s *SQLiteStore) Create(ctx context.Context, u *User) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		u.ID, u.Username, u.PasswordHash, u.CreatedAt.Unix())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return ErrUserExists
		}
		return fmt.Errorf("user: create: %w", err)
	}
	return nil
}

// GetByID 按 ID 查询；不存在返回 ErrNotFound。
func (s *SQLiteStore) GetByID(ctx context.Context, id string) (*User, error) {
	return s.scanOne(s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, created_at FROM users WHERE id = ?`, id))
}

// GetByUsername 按用户名查询；不存在返回 ErrNotFound。
func (s *SQLiteStore) GetByUsername(ctx context.Context, username string) (*User, error) {
	return s.scanOne(s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`, username))
}

func (s *SQLiteStore) scanOne(row *sql.Row) (*User, error) {
	var u User
	var created int64
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("user: scan: %w", err)
	}
	u.CreatedAt = time.Unix(created, 0)
	return &u, nil
}

// NewID 生成随机用户 ID（32 位十六进制）。
func NewID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("user: rand: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
