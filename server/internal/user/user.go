// Package user 提供用户注册/登录与 JWT 认证（M3）。
package user

import "time"

// User 用户实体（GORM 模型，自动迁移建表 users）。
type User struct {
	ID           string    `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"uniqueIndex;size:32" json:"username"`
	PasswordHash string    `gorm:"size:255" json:"-"` // bcrypt 哈希，禁止出现在 JSON
	CreatedAt    time.Time `json:"created_at"`
}
