// Package user 提供用户注册/登录与 JWT 认证（M3，实现中）。
package user

import "time"

// User 用户实体。
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"` // bcrypt 哈希，禁止出现在 JSON
	CreatedAt    time.Time `json:"created_at"`
}
