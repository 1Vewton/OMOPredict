package api

import "github.com/1Vewton/OMOPredict/server/internal/mode"

// 认证模式与引擎传输方式的取值/解析集中在中立的 internal/mode 包
// （HTTP 与 stdio RPC 共用，避免两套定义漂移）；此处以别名暴露，保持既有调用点不变。
//
// AuthMode 认证模式（OMO_AUTH_MODE）。
type AuthMode = mode.AuthMode

const (
	// AuthModeJWT 多用户 + JWT（Web 部署默认）。
	AuthModeJWT = mode.JWT
	// AuthModeNone 单用户本地模式（桌面版）：不做认证，所有任务归属固定本地用户。
	// 仅应由桌面 Host 注入；Web 部署误设为 none 等于关闭认证（docs/desktop.md D10）。
	AuthModeNone = mode.None

	// EngineTransportHTTP 通过 HTTP 调用引擎（Web/开发模式默认）。
	EngineTransportHTTP = mode.TransportHTTP
	// EngineTransportStdio 通过 stdio JSON-RPC 调用引擎（桌面模式）。
	EngineTransportStdio = mode.TransportStdio
)

// ParseAuthMode 解析 OMO_AUTH_MODE（见 mode.ParseAuthMode）。
func ParseAuthMode(v string) (AuthMode, error) {
	return mode.ParseAuthMode(v)
}

// ParseEngineTransport 解析 OMO_ENGINE_TRANSPORT（见 mode.ParseEngineTransport）。
func ParseEngineTransport(v string) (string, error) {
	return mode.ParseEngineTransport(v)
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

// meta 能力声明（与 RPC `meta` 方法同一结构，见 mode.Meta）。
func (c Config) meta() mode.Meta {
	return mode.NewMeta(c.version(), c.authMode(), c.engineTransport())
}
