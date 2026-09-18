package rpc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/api"
	"github.com/1Vewton/OMOPredict/server/internal/mode"
	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/store/storetest"
	"github.com/1Vewton/OMOPredict/server/internal/task"
	"github.com/1Vewton/OMOPredict/server/internal/user"
	"gorm.io/gorm"
)

// newTestDB 内存 SQLite + 迁移 users/tasks 表（每个测试实例独立，见 storetest）。
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	return storetest.OpenMemory(t, &user.User{}, &model.SimulationTask{})
}

// setupPeers 构造共享同一假引擎的 HTTP（本地模式）与 RPC 两个传输端。
//
// 契约一致性：同一请求分别经两种传输执行，载荷应逐字段相同（docs/desktop.md D11）。
func setupPeers(t *testing.T) (http.Handler, *Server) {
	t.Helper()
	engine := fakeEngine(t)

	dbHTTP := newTestDB(t)
	users := user.NewService(user.NewGORMStore(dbHTTP), []byte("test-secret"), time.Hour)
	tasksHTTP := task.NewService(task.NewGORMStore(dbHTTP), task.NewEngineClient(engine.URL))
	router := api.NewRouter(users, tasksHTTP, api.Config{
		AuthMode:        api.AuthModeNone,
		Version:         "test-ver",
		EngineTransport: api.EngineTransportHTTP,
	})

	dbRPC := newTestDB(t)
	tasksRPC := task.NewService(task.NewGORMStore(dbRPC), task.NewEngineClient(engine.URL))
	srv, err := NewServer(tasksRPC, Config{
		AuthMode:        mode.None,
		Version:         "test-ver",
		EngineTransport: mode.TransportHTTP,
	})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	return router, srv
}

// compact 把载荷序列化为单行 JSON（HTTP body 与 RPC params 共用同一份载荷）。
func compact(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return string(b)
}

// httpCall 发一次 HTTP 请求并返回状态码与解析后的 JSON 对象。
func httpCall(
	t *testing.T, router http.Handler, method, path, body string,
) (int, map[string]any) {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	out := map[string]any{}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("HTTP 响应非法 JSON: %v (%s)", err, rec.Body.String())
		}
	}
	return rec.Code, out
}

// TestMetaParity meta：HTTP 与 RPC 返回逐字段一致。
func TestMetaParity(t *testing.T) {
	t.Parallel()
	router, srv := setupPeers(t)
	code, httpMeta := httpCall(t, router, http.MethodGet, "/api/meta", "")
	if code != http.StatusOK {
		t.Fatalf("HTTP meta status = %d", code)
	}
	rpcMeta := resultMap(t, serve(t, srv, line(t, request(1, "meta", nil)))[0])
	if !reflect.DeepEqual(httpMeta, rpcMeta) {
		t.Fatalf("meta 不一致:\nHTTP = %+v\nRPC  = %+v", httpMeta, rpcMeta)
	}
}

// taskComparable 提取可跨传输比对的字段（id/时间戳随实例而异，不参与比对）。
func taskComparable(m map[string]any) map[string]any {
	out := map[string]any{}
	for _, k := range []string{"kind", "user_id", "name", "status", "stack", "optimize"} {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

// TestCreateTaskParity tasks.create：同一请求体，HTTP 与 RPC 结果字段一致。
func TestCreateTaskParity(t *testing.T) {
	t.Parallel()
	router, srv := setupPeers(t)

	simPayload := map[string]any{
		"name": "契约比对",
		"layers": []map[string]any{
			{"material": "ITO", "thickness_nm": 40},
			{"material": "Ag", "thickness_nm": 10},
			{"material": "ITO", "thickness_nm": 40},
		},
	}
	_, httpTask := httpCall(t, router, http.MethodPost, "/api/tasks", compact(t, simPayload))
	rpcTask := resultMap(t, serve(t, srv,
		line(t, request(1, "tasks.create", simPayload)))[0])
	if !reflect.DeepEqual(taskComparable(httpTask), taskComparable(rpcTask)) {
		t.Fatalf("创建结果不一致:\nHTTP = %+v\nRPC  = %+v",
			taskComparable(httpTask), taskComparable(rpcTask))
	}

	// 反推任务（kind=optimize）同样比对
	optPayload := map[string]any{
		"kind":     "optimize",
		"name":     "反推契约",
		"optimize": map[string]any{"target": map[string]any{"max_sheet_resistance": 12}},
	}
	_, httpOpt := httpCall(t, router, http.MethodPost, "/api/tasks", compact(t, optPayload))
	rpcOpt := resultMap(t, serve(t, srv,
		line(t, request(2, "tasks.create", optPayload)))[0])
	if !reflect.DeepEqual(taskComparable(httpOpt), taskComparable(rpcOpt)) {
		t.Fatalf("反推任务不一致:\nHTTP = %+v\nRPC  = %+v",
			taskComparable(httpOpt), taskComparable(rpcOpt))
	}
}

// TestValidationErrorParity 校验失败：HTTP 400 的 error 文本与 RPC 400 的 message 相同。
func TestValidationErrorParity(t *testing.T) {
	t.Parallel()
	router, srv := setupPeers(t)
	body := `{"layers":[]}`

	code, httpErr := httpCall(t, router, http.MethodPost, "/api/tasks", body)
	if code != http.StatusBadRequest {
		t.Fatalf("HTTP status = %d, want 400", code)
	}
	rpcErr := serve(t, srv,
		line(t, request(1, "tasks.create", map[string]any{"layers": []any{}})))[0].Error
	if rpcErr == nil || rpcErr.Code != http.StatusBadRequest {
		t.Fatalf("RPC 错误 = %+v, want code 400", rpcErr)
	}
	if httpErr["error"] != rpcErr.Message {
		t.Fatalf("错误消息不一致: HTTP %q vs RPC %q", httpErr["error"], rpcErr.Message)
	}
}

// TestNotFoundParity 不存在的任务：两侧同为 404 且消息一致。
func TestNotFoundParity(t *testing.T) {
	t.Parallel()
	router, srv := setupPeers(t)
	const missing = "no-such-task"

	code, httpErr := httpCall(t, router, http.MethodGet, "/api/tasks/"+missing, "")
	if code != http.StatusNotFound {
		t.Fatalf("HTTP status = %d, want 404", code)
	}
	rpcErr := serve(t, srv,
		line(t, request(1, "tasks.get", map[string]any{"id": missing})))[0].Error
	if rpcErr == nil || rpcErr.Code != http.StatusNotFound {
		t.Fatalf("RPC 错误 = %+v, want code 404", rpcErr)
	}
	if httpErr["error"] != rpcErr.Message {
		t.Fatalf("404 消息不一致: HTTP %q vs RPC %q", httpErr["error"], rpcErr.Message)
	}
}

// TestDeleteParity tasks.delete：两侧响应结构一致。
func TestDeleteParity(t *testing.T) {
	t.Parallel()
	router, srv := setupPeers(t)
	payload := map[string]any{
		"name":   "待删",
		"layers": []map[string]any{{"material": "ITO", "thickness_nm": 40}},
	}

	_, httpTask := httpCall(t, router, http.MethodPost, "/api/tasks", compact(t, payload))
	httpID, _ := httpTask["id"].(string)
	rpcTask := resultMap(t, serve(t, srv, line(t, request(1, "tasks.create", payload)))[0])
	rpcID, _ := rpcTask["id"].(string)

	code, httpDel := httpCall(t, router, http.MethodDelete, "/api/tasks/"+httpID, "")
	if code != http.StatusOK || httpDel["deleted"] != true {
		t.Fatalf("HTTP 删除异常: %d %+v", code, httpDel)
	}
	rpcDel := resultMap(t, serve(t, srv,
		line(t, request(2, "tasks.delete", map[string]any{"id": rpcID})))[0])
	if rpcDel["deleted"] != true {
		t.Fatalf("RPC 删除异常: %+v", rpcDel)
	}
	// 键集合一致（id 值不同）
	if len(httpDel) != len(rpcDel) {
		t.Fatalf("删除响应键数不一致: HTTP %v vs RPC %v", httpDel, rpcDel)
	}
	for k := range httpDel {
		if _, ok := rpcDel[k]; !ok {
			t.Fatalf("RPC 删除响应缺键 %q: %+v", k, rpcDel)
		}
	}
}
