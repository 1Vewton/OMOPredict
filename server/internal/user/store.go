// Package user 提供用户注册/登录与 JWT 认证（M3）。
package user

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"gorm.io/gorm"
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

// GORMStore 基于 GORM 的用户存储（兼容 sqlite / mysql / postgres）。
type GORMStore struct {
	db *gorm.DB
}

// NewGORMStore 构造 GORM 用户存储。
func NewGORMStore(db *gorm.DB) *GORMStore {
	return &GORMStore{db: db}
}

// Close 关闭底层数据库连接。
func (s *GORMStore) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return fmt.Errorf("user: get sql db: %w", err)
	}
	return sqlDB.Close()
}

// Create 插入用户；用户名重复返回 ErrUserExists。
func (s *GORMStore) Create(ctx context.Context, u *User) error {
	if err := s.db.WithContext(ctx).Create(u).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return ErrUserExists
		}
		return fmt.Errorf("user: create: %w", err)
	}
	return nil
}

// GetByID 按 ID 查询；不存在返回 ErrNotFound。
func (s *GORMStore) GetByID(ctx context.Context, id string) (*User, error) {
	return s.get(ctx, "id = ?", id)
}

// GetByUsername 按用户名查询；不存在返回 ErrNotFound。
func (s *GORMStore) GetByUsername(ctx context.Context, username string) (*User, error) {
	return s.get(ctx, "username = ?", username)
}

func (s *GORMStore) get(ctx context.Context, query string, arg any) (*User, error) {
	var u User
	err := s.db.WithContext(ctx).Where(query, arg).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("user: get: %w", err)
	}
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
