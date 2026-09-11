package api

import "net/http"

// metaResponse GET /api/meta 响应：前端据此决定是否显示登录流程。
type metaResponse struct {
	// Version 服务版本（可 ldflags 注入）。
	Version string `json:"version"`
	// AuthMode 生效的认证模式：jwt | none。
	AuthMode string `json:"auth_mode"`
	// AuthRequired 是否需要认证（前端门禁：false 时跳过登录页与守卫）。
	AuthRequired bool `json:"auth_required"`
	// EngineTransport 引擎传输方式：http | stdio。
	EngineTransport string `json:"engine_transport"`
}

// metaHandler GET /api/meta —— 运行模式与能力声明（无需认证，任何模式都可访问）。
func metaHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, metaResponse{
			Version:         cfg.version(),
			AuthMode:        string(cfg.authMode()),
			AuthRequired:    cfg.authRequired(),
			EngineTransport: cfg.engineTransport(),
		})
	}
}
