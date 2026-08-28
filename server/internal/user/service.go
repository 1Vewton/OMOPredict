// Package user 提供用户注册/登录与 JWT 认证（M3）。
package user

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// 输入校验规则。
const (
	MinPasswordLen = 8
	MaxUsernameLen = 32
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,32}$`)

// 服务层错误。
var (
	ErrInvalidUsername = errors.New("user: username must be 3-32 chars of [a-zA-Z0-9_]")
	ErrWeakPassword    = fmt.Errorf("user: password too weak (min %d chars)", MinPasswordLen)
	ErrBadCredentials  = errors.New("user: invalid username or password")
)

// Service 用户服务：注册 / 登录 / 令牌验证。
type Service struct {
	store  Store
	secret []byte
	ttl    time.Duration
}

// NewService 构造用户服务。
// secret 为 JWT 签名密钥（HS256）；ttl 为令牌有效期。
func NewService(store Store, secret []byte, ttl time.Duration) *Service {
	return &Service{store: store, secret: secret, ttl: ttl}
}

// claims JWT 载荷。
type claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// Register 注册用户（bcrypt 哈希存储）。
//
// 异常:
//   - ErrInvalidUsername / ErrWeakPassword：输入不合法
//   - ErrUserExists：用户名已存在
func (s *Service) Register(ctx context.Context, username, password string) (*User, error) {
	if !usernameRe.MatchString(username) {
		return nil, ErrInvalidUsername
	}
	if len(password) < MinPasswordLen {
		return nil, ErrWeakPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("user: hash: %w", err)
	}
	id, err := NewID()
	if err != nil {
		return nil, err
	}
	u := &User{
		ID:           id,
		Username:     username,
		PasswordHash: string(hash),
		CreatedAt:    time.Now().UTC(),
	}
	if err := s.store.Create(ctx, u); err != nil {
		return nil, err // ErrUserExists 原样透传
	}
	return u, nil
}

// Login 校验凭据并签发 JWT。
//
// 异常: ErrBadCredentials（用户名不存在或密码错误）
func (s *Service) Login(ctx context.Context, username, password string) (token string, u *User, err error) {
	u, err = s.store.GetByUsername(ctx, username)
	if errors.Is(err, ErrNotFound) {
		return "", nil, ErrBadCredentials
	}
	if err != nil {
		return "", nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return "", nil, ErrBadCredentials
	}
	token, err = s.issueToken(u)
	if err != nil {
		return "", nil, err
	}
	return token, u, nil
}

func (s *Service) issueToken(u *User) (string, error) {
	now := time.Now().UTC()
	c := claims{
		Username: u.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.ID,
			Issuer:    "omopredict",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.secret)
}

// VerifyToken 校验 JWT（签名、过期）并返回对应用户。
//
// 异常: ErrBadCredentials（令牌非法或已过期）
func (s *Service) VerifyToken(ctx context.Context, token string) (*User, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("user: unexpected signing method %v", t.Method)
		}
		return s.secret, nil
	}, jwt.WithExpirationRequired())
	if err != nil {
		return nil, ErrBadCredentials
	}
	return s.store.GetByID(ctx, c.Subject)
}
