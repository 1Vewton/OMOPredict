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
func registerHandler(svc *user.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
func loginHandler(svc *user.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

// meHandler GET /api/auth/me —— 返回当前用户（需认证）。
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

// authMiddleware 校验 Bearer JWT，并把当前用户注入请求上下文。
func authMiddleware(svc *user.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
