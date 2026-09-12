// Package mode 定义运行模式相关的中立类型（HTTP 与 stdio RPC 两种传输共用）。
//
// 抽取动机（docs/desktop.md D10/D11）：认证模式与能力声明既要被 HTTP 传输使用，
// 也要被 stdio RPC 传输使用；放在中立的包里可避免两种传输各自定义一套而漂移。
package mode

import (
	"fmt"
	"strings"
)

// AuthMode 认证模式（OMO_AUTH_MODE）。
type AuthMode string

const (
	// JWT 多用户 + JWT（Web 部署默认）。
	JWT AuthMode = "jwt"
	// None 单用户本地模式（桌面版）：不做认证，所有任务归属固定本地用户。
	// 仅应由桌面 Host 注入；Web 部署误设为 none 等于关闭认证。
	None AuthMode = "none"
)

// 引擎传输方式（OMO_ENGINE_TRANSPORT）。
const (
	// TransportHTTP 通过 HTTP 调用引擎（Web/开发模式默认）。
	TransportHTTP = "http"
	// TransportStdio 通过 stdio JSON-RPC 调用引擎（桌面模式）。
	TransportStdio = "stdio"
)

// ParseAuthMode 解析 OMO_AUTH_MODE；空值与大小写不敏感，非法值报错。
func ParseAuthMode(v string) (AuthMode, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", string(JWT):
		return JWT, nil
	case string(None):
		return None, nil
	default:
		return "", fmt.Errorf("mode: 非法 OMO_AUTH_MODE %q（可选 jwt | none）", v)
	}
}

// ParseEngineTransport 解析 OMO_ENGINE_TRANSPORT；空值默认 http。
func ParseEngineTransport(v string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", TransportHTTP:
		return TransportHTTP, nil
	case TransportStdio:
		return TransportStdio, nil
	default:
		return "", fmt.Errorf("mode: 非法 OMO_ENGINE_TRANSPORT %q（可选 http | stdio）", v)
	}
}

// AuthRequired 是否需要客户端认证。
func (m AuthMode) AuthRequired() bool {
	return m != None
}

// Meta 能力声明（HTTP `GET /api/meta` 与 RPC `meta` 共用同一 JSON 结构）。
type Meta struct {
	// Version 服务版本（可 ldflags 注入）。
	Version string `json:"version"`
	// AuthMode 生效的认证模式：jwt | none。
	AuthMode string `json:"auth_mode"`
	// AuthRequired 是否需要认证（前端门禁：false 时跳过登录页与守卫）。
	AuthRequired bool `json:"auth_required"`
	// EngineTransport 引擎传输方式：http | stdio。
	EngineTransport string `json:"engine_transport"`
}

// NewMeta 构造能力声明（Version 为空时由调用方兜底）。
func NewMeta(version string, auth AuthMode, transport string) Meta {
	if transport == "" {
		transport = TransportHTTP
	}
	return Meta{
		Version:         version,
		AuthMode:        string(auth),
		AuthRequired:    auth.AuthRequired(),
		EngineTransport: transport,
	}
}
