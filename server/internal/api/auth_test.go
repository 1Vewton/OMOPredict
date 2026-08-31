package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

// newTestService 用临时 SQLite 库（GORM）构造用户服务。
func newTestService(t *testing.T) *user.Service {
	t.Helper()
	db, err := store.Open(store.Config{
		Driver: store.DriverSQLite,
		DSN:    filepath.Join(t.TempDir(), "test.db"),
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := store.Migrate(db, &user.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, cerr := db.DB(); cerr == nil {
			_ = sqlDB.Close()
		}
	})
	return user.NewService(user.NewGORMStore(db), []byte("test-secret"), time.Hour)
}

func doJSON(t *testing.T, r *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	NewRouter(newTestService(t)).ServeHTTP(rec, r)
	return rec
}

func TestRegisterLoginMeFlow(t *testing.T) {
	svc := newTestService(t)
	router := NewRouter(svc)

	// 注册
	reg := httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"username":"alice","password":"supersecret"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, reg)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body=%s", rec.Code, rec.Body.String())
	}

	// 重复注册 → 409
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"username":"alice","password":"supersecret"}`)))
	if rec2.Code != http.StatusConflict {
		t.Fatalf("duplicate register status = %d, want 409", rec2.Code)
	}

	// 登录 → token
	login := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"alice","password":"supersecret"}`))
	rec3 := httptest.NewRecorder()
	router.ServeHTTP(rec3, login)
	if rec3.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", rec3.Code, rec3.Body.String())
	}
	var lr loginResponse
	if err := json.Unmarshal(rec3.Body.Bytes(), &lr); err != nil || lr.Token == "" {
		t.Fatalf("login response invalid: %v %s", err, rec3.Body.String())
	}

	// me 带 token → 200
	me := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	me.Header.Set("Authorization", "Bearer "+lr.Token)
	rec4 := httptest.NewRecorder()
	router.ServeHTTP(rec4, me)
	if rec4.Code != http.StatusOK {
		t.Fatalf("me status = %d, body=%s", rec4.Code, rec4.Body.String())
	}
	var view userView
	if err := json.Unmarshal(rec4.Body.Bytes(), &view); err != nil || view.Username != "alice" {
		t.Fatalf("me response invalid: %v %s", err, rec4.Body.String())
	}

	// me 无 token → 401
	rec5 := httptest.NewRecorder()
	router.ServeHTTP(rec5, httptest.NewRequest(http.MethodGet, "/api/auth/me", nil))
	if rec5.Code != http.StatusUnauthorized {
		t.Fatalf("me without token status = %d, want 401", rec5.Code)
	}

	// me 坏 token → 401
	bad := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	bad.Header.Set("Authorization", "Bearer not-a-jwt")
	rec6 := httptest.NewRecorder()
	router.ServeHTTP(rec6, bad)
	if rec6.Code != http.StatusUnauthorized {
		t.Fatalf("me bad token status = %d, want 401", rec6.Code)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	svc := newTestService(t)
	router := NewRouter(svc)
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost,
		"/api/auth/register", strings.NewReader(`{"username":"alice","password":"supersecret"}`)))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"alice","password":"wrongpass1"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("login wrong password status = %d, want 401", rec.Code)
	}
}

func TestRegisterWeakPassword400(t *testing.T) {
	rec := doJSON(t, httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"username":"alice","password":"short"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("weak password status = %d, want 400", rec.Code)
	}
}

func TestRegisterBadJSON400(t *testing.T) {
	rec := doJSON(t, httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{not json`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json status = %d, want 400", rec.Code)
	}
}
