package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/1Vewton/OMOPredict/server/internal/user"
)

// ctxKey 请求上下文键。
type ctxKey int

const userCtxKey ctxKey = 0

// msgAuthDisabled 单用户（本地）模式下认证接口的提示。
const msgAuthDisabled = "auth disabled in single-user (local) mode"

// userFromContext 取当前认证用户。
func userFromContext(ctx context.Context) (*user.User, bool) {
	u, ok := ctx.Value(userCtxKey).(*user.User)
	return u, ok
}

type authRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type userView struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type loginResponse struct {
	Token string   `json:"token"`
	User  userView `json:"user"`
}

// registerHandler POST /api/auth/register —— 注册新用户。
//
// 单用户模式（OMO_AUTH_MODE=none）下不可用：返回 401（前端在本地模式不会调用）。
func registerHandler(svc *user.Service, mode AuthMode) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if mode == AuthModeNone {
			writeError(w, http.StatusUnauthorized, msgAuthDisabled)
			return
		}
		var req authRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		u, err := svc.Register(r.Context(), req.Username, req.Password)
		if errors.Is(err, user.ErrUserExists) {
			writeError(w, http.StatusConflict, "username already exists")
			return
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, userView{ID: u.ID, Username: u.Username})
	}
}

// loginHandler POST /api/auth/login —— 校验凭据并签发 JWT。
//
// 单用户模式（OMO_AUTH_MODE=none）下不可用：返回 401。
func loginHandler(svc *user.Service, mode AuthMode) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if mode == AuthModeNone {
			writeError(w, http.StatusUnauthorized, msgAuthDisabled)
			return
		}
		var req authRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		token, u, err := svc.Login(r.Context(), req.Username, req.Password)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid username or password")
			return
		}
		writeJSON(w, http.StatusOK, loginResponse{
			Token: token,
			User:  userView{ID: u.ID, Username: u.Username},
		})
	}
}

// meHandler GET /api/auth/me —— 返回当前用户（需认证；单用户模式返回本地用户）。
func meHandler(svc *user.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		writeJSON(w, http.StatusOK, userView{ID: u.ID, Username: u.Username})
	}
}

// authMiddleware 认证中间件。
//
// 模式 jwt：校验 Bearer JWT 并把用户注入请求上下文（现有行为）。
// 模式 none：不做认证，直接注入固定本地用户（user.LocalUser）——单用户本地应用（D10）。
func authMiddleware(svc *user.Service, mode AuthMode) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if mode == AuthModeNone {
				ctx := context.WithValue(r.Context(), userCtxKey, user.LocalUser)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || token == "" {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			u, err := svc.VerifyToken(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}
			ctx := context.WithValue(r.Context(), userCtxKey, u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// writeError 统一错误响应 {"error": msg}。
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
