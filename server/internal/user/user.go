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

// LocalUserID 单用户（桌面）模式下的固定用户 ID。
const LocalUserID = "local"

// LocalUser 单用户模式下的固定用户：不落库、不参与认证，
// 由认证中间件在 OMO_AUTH_MODE=none 时注入请求上下文（docs/desktop.md D10）。
var LocalUser = &User{ID: LocalUserID, Username: LocalUserID}
