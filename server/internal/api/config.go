package api

import (
	"fmt"
	"strings"
)

// AuthMode 认证模式（OMO_AUTH_MODE）。
type AuthMode string

const (
	// AuthModeJWT 多用户 + JWT（Web 部署默认）。
	AuthModeJWT AuthMode = "jwt"
	// AuthModeNone 单用户本地模式（桌面版）：不做认证，所有任务归属固定本地用户。
	// 仅应由桌面 Host 注入；Web 部署误设为 none 等于关闭认证（docs/desktop.md D10）。
	AuthModeNone AuthMode = "none"
)

// 引擎传输方式（OMO_ENGINE_TRANSPORT）。
const (
	// EngineTransportHTTP 通过 HTTP 调用引擎（Web/开发模式默认）。
	EngineTransportHTTP = "http"
	// EngineTransportStdio 通过 stdio JSON-RPC 调用引擎（桌面模式，T3 落地）。
	EngineTransportStdio = "stdio"
)

// ParseAuthMode 解析 OMO_AUTH_MODE；空值与大小写不敏感，非法值报错。
func ParseAuthMode(v string) (AuthMode, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", string(AuthModeJWT):
		return AuthModeJWT, nil
	case string(AuthModeNone):
		return AuthModeNone, nil
	default:
		return "", fmt.Errorf("api: 非法 OMO_AUTH_MODE %q（可选 jwt | none）", v)
	}
}

// ParseEngineTransport 解析 OMO_ENGINE_TRANSPORT；空值默认 http。
func ParseEngineTransport(v string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", EngineTransportHTTP:
		return EngineTransportHTTP, nil
	case EngineTransportStdio:
		return EngineTransportStdio, nil
	default:
		return "", fmt.Errorf("api: 非法 OMO_ENGINE_TRANSPORT %q（可选 http | stdio）", v)
	}
}

// Config 路由装配配置（零值等价于 Web 默认：jwt + http）。
type Config struct {
	AuthMode        AuthMode // 空 = jwt
	Version         string   // 空 = 包级 version（可用 ldflags 注入）
	EngineTransport string   // 空 = http；目前仅透出给 /api/meta
}

// authMode 生效的认证模式。
func (c Config) authMode() AuthMode {
	if c.AuthMode == "" {
		return AuthModeJWT
	}
	return c.AuthMode
}

// version 生效的版本号。
func (c Config) version() string {
	if c.Version == "" {
		return version
	}
	return c.Version
}

// engineTransport 生效的引擎传输方式。
func (c Config) engineTransport() string {
	if c.EngineTransport == "" {
		return EngineTransportHTTP
	}
	return c.EngineTransport
}

// authRequired 是否需要客户端认证（供 /api/meta 与前端门禁使用）。
func (c Config) authRequired() bool {
	return c.authMode() != AuthModeNone
}
