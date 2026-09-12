package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// deleteTask 发起 DELETE /api/tasks/{id}（token 为空表示不带 Authorization）。
func deleteTask(t *testing.T, router http.Handler, token, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/tasks/"+id, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// getTask 发起 GET /api/tasks/{id}。
func getTask(t *testing.T, router http.Handler, token, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/tasks/"+id, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// listTaskCount 返回当前用户任务数。
func listTaskCount(t *testing.T, router http.Handler, token string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var out taskListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	return len(out.Tasks)
}

// TestTaskDeleteFlow 删除成功：200 → 之后 GET 404、列表为空。
func TestTaskDeleteFlow(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")

	rec := postTask(t, router, token, itoAgItoBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	waitForTask(t, router, token, created.ID, model.TaskSucceeded)

	del := deleteTask(t, router, token, created.ID)
	if del.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body=%s", del.Code, del.Body.String())
	}
	var resp deleteTaskResponse
	if err := json.Unmarshal(del.Body.Bytes(), &resp); err != nil {
		t.Fatalf("delete response JSON 非法: %v", err)
	}
	if !resp.Deleted || resp.ID != created.ID {
		t.Fatalf("delete response = %+v, want {id:%s, deleted:true}", resp, created.ID)
	}

	if code := getTask(t, router, token, created.ID).Code; code != http.StatusNotFound {
		t.Fatalf("删除后 GET status = %d, want 404", code)
	}
	if n := listTaskCount(t, router, token); n != 0 {
		t.Fatalf("删除后任务数 = %d, want 0", n)
	}
}

// TestTaskDeleteOptimizeKind 反推任务同样可删除。
func TestTaskDeleteOptimizeKind(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")

	rec := postTask(t, router, token, optimizeTaskBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	waitForTask(t, router, token, created.ID, model.TaskSucceeded)

	if code := deleteTask(t, router, token, created.ID).Code; code != http.StatusOK {
		t.Fatalf("删除反推任务 status = %d, want 200", code)
	}
	if n := listTaskCount(t, router, token); n != 0 {
		t.Fatalf("删除后任务数 = %d, want 0", n)
	}
}

// TestTaskDeleteNotFound 不存在的 ID → 404。
func TestTaskDeleteNotFound(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")
	if code := deleteTask(t, router, token, "does-not-exist").Code; code != http.StatusNotFound {
		t.Fatalf("删除不存在任务 status = %d, want 404", code)
	}
}

// TestTaskDeleteOwnership 他人任务 → 404，且原任务不受影响。
func TestTaskDeleteOwnership(t *testing.T) {
	router := newTestRouter(t)
	tokenA := registerAndLogin(t, router, "alice")
	tokenB := registerAndLogin(t, router, "bob")

	rec := postTask(t, router, tokenA, itoAgItoBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	waitForTask(t, router, tokenA, created.ID, model.TaskSucceeded)

	// bob 删 alice 的任务 → 404
	if code := deleteTask(t, router, tokenB, created.ID).Code; code != http.StatusNotFound {
		t.Fatalf("跨用户删除 status = %d, want 404", code)
	}
	// alice 的任务仍在
	if code := getTask(t, router, tokenA, created.ID).Code; code != http.StatusOK {
		t.Fatalf("跨用户删除后 owner GET status = %d, want 200", code)
	}
	// bob 自己的列表不受影响
	if n := listTaskCount(t, router, tokenB); n != 0 {
		t.Fatalf("bob 任务数 = %d, want 0", n)
	}
	// alice 可以删除自己的
	if code := deleteTask(t, router, tokenA, created.ID).Code; code != http.StatusOK {
		t.Fatalf("owner 删除 status = %d, want 200", code)
	}
}

// TestTaskDeleteUnauthorized jwt 模式无 token → 401。
func TestTaskDeleteUnauthorized(t *testing.T) {
	router := newTestRouter(t)
	if code := deleteTask(t, router, "", "any-id").Code; code != http.StatusUnauthorized {
		t.Fatalf("无 token 删除 status = %d, want 401", code)
	}
}

// TestLocalModeTaskDelete 单用户本地模式：无需 token 即可删除。
func TestLocalModeTaskDelete(t *testing.T) {
	router := newTestRouterWithConfig(t, Config{AuthMode: AuthModeNone})

	rec := postTask(t, router, "", itoAgItoBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	waitForTask(t, router, "", created.ID, model.TaskSucceeded)

	if n := listTaskCount(t, router, ""); n != 1 {
		t.Fatalf("删除前任务数 = %d, want 1", n)
	}
	if code := deleteTask(t, router, "", created.ID).Code; code != http.StatusOK {
		t.Fatalf("本地模式删除 status = %d, want 200", code)
	}
	if n := listTaskCount(t, router, ""); n != 0 {
		t.Fatalf("本地模式删除后任务数 = %d, want 0", n)
	}
}
