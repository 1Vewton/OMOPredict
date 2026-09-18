package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

// getMeta 请求 /api/meta（无需认证）。
func getMeta(t *testing.T, router http.Handler) metaResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/meta", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("meta status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var m metaResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("meta JSON 非法: %v (%s)", err, rec.Body.String())
	}
	return m
}

// TestMetaDefaultJWTMode 默认（Web）模式：需要认证、引擎走 http。
func TestMetaDefaultJWTMode(t *testing.T) {
	t.Parallel()
	m := getMeta(t, newTestRouter(t))
	if m.AuthMode != string(AuthModeJWT) {
		t.Fatalf("auth_mode = %q, want jwt", m.AuthMode)
	}
	if !m.AuthRequired {
		t.Fatal("auth_required 应为 true")
	}
	if m.EngineTransport != EngineTransportHTTP {
		t.Fatalf("engine_transport = %q, want http", m.EngineTransport)
	}
	if m.Version == "" {
		t.Fatal("version 不应为空")
	}
}

// TestMetaLocalMode 桌面本地模式：不需要认证、引擎走 stdio、版本可覆盖。
func TestMetaLocalMode(t *testing.T) {
	t.Parallel()
	router := newTestRouterWithConfig(t, Config{
		AuthMode:        AuthModeNone,
		EngineTransport: EngineTransportStdio,
		Version:         "1.2.3-local",
	})
	m := getMeta(t, router)
	if m.AuthMode != string(AuthModeNone) || m.AuthRequired {
		t.Fatalf("本模式下 meta = %+v，want auth_mode=none & auth_required=false", m)
	}
	if m.EngineTransport != EngineTransportStdio {
		t.Fatalf("engine_transport = %q, want stdio", m.EngineTransport)
	}
	if m.Version != "1.2.3-local" {
		t.Fatalf("version = %q, want 1.2.3-local", m.Version)
	}
}

// TestAuthEndpointsDisabledInLocalMode 本地模式下认证接口关闭：注册/登录 401，me 返回本地用户。
func TestAuthEndpointsDisabledInLocalMode(t *testing.T) {
	t.Parallel()
	router := newTestRouterWithConfig(t, Config{AuthMode: AuthModeNone})

	for _, path := range []string{"/api/auth/register", "/api/auth/login"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path,
			strings.NewReader(`{"username":"alice","password":"supersecret"}`)))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s 本地模式 status = %d, want 401", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "auth disabled") {
			t.Fatalf("%s 错误消息不含 auth disabled: %s", path, rec.Body.String())
		}
	}

	// me：无 token 也应返回本地用户（由中间件注入）
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/me", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("本地模式 me status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var view userView
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatalf("me JSON 非法: %v", err)
	}
	if view.ID != user.LocalUserID || view.Username != user.LocalUserID {
		t.Fatalf("me = %+v, want 本地用户 %q", view, user.LocalUserID)
	}
}

// TestLocalModeTaskFlowWithoutToken 本地模式下无需任何 token 即可创建/轮询/列出任务，
// 且任务归属固定本地用户。
func TestLocalModeTaskFlowWithoutToken(t *testing.T) {
	t.Parallel()
	router := newTestRouterWithConfig(t, Config{AuthMode: AuthModeNone})

	// 创建（不带 Authorization 头）
	rec := postTask(t, router, "", itoAgItoBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("本地模式创建任务 status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var created model.SimulationTask
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.UserID != user.LocalUserID {
		t.Fatalf("任务 user_id = %q, want %q", created.UserID, user.LocalUserID)
	}

	// 轮询到成功（本地模式忽略 Bearer 头）
	done := waitForTask(t, router, "", created.ID, model.TaskSucceeded)
	if done.Result == nil || done.Result.SheetResistance == nil {
		t.Fatalf("结果异常: %+v", done.Result)
	}

	// 列表
	listReq := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("本地模式列表 status = %d", listRec.Code)
	}
	var out taskListResponse
	if err := json.Unmarshal(listRec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(out.Tasks) != 1 || out.Tasks[0].ID != created.ID {
		t.Fatalf("列表内容异常: %+v", out.Tasks)
	}
}
