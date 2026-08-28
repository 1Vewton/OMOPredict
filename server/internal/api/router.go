// Package api 提供 REST 路由与中间件（M3）。
//
// 约定：
//   - 字段命名 snake_case（与 Python 引擎 JSON 一致）；
//   - 只做请求/响应封装与编排，不含物理逻辑。
package api

import (
	"encoding/json"
	"net/http"
	"runtime"
	"time"
)

// version 服务版本（可用 ldflags 注入）。
var version = "0.1.0"

// NewRouter 组装全部路由（Go 1.22+ 方法化模式）。
func NewRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /version", handleVersion)
	return withMiddleware(mux)
}

type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Time    string `json:"time"`
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{
		Status:  "ok",
		Version: version,
		Time:    time.Now().UTC().Format(time.RFC3339),
	})
}

func handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"version": version,
		"go":      runtime.Version(),
	})
}

// writeJSON 统一 JSON 响应。
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// withMiddleware 组装通用中间件（日志、panic 兜底）。
func withMiddleware(next http.Handler) http.Handler {
	return logMiddleware(recoverMiddleware(next))
}
