package api

import (
	"net/http"

	"github.com/1Vewton/OMOPredict/server/internal/mode"
)

// metaResponse GET /api/meta 响应：与 RPC `meta` 方法共用同一结构（mode.Meta）。
type metaResponse = mode.Meta

// metaHandler GET /api/meta —— 运行模式与能力声明（无需认证，任何模式都可访问）。
func metaHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, cfg.meta())
	}
}
