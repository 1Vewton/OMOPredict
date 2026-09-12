package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/mode"
	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/task"
)

// fakeEngine 模拟 Python 引擎（/simulate 与 /optimize）。
func fakeEngine(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/simulate":
			rs := 3.9708
			_ = json.NewEncoder(w).Encode(map[string]any{
				"transmittance":    []model.SpectrumPoint{{X: 550, Value: 0.9745}},
				"reflectance":      []model.SpectrumPoint{{X: 550, Value: 0.0162}},
				"sheet_resistance": rs,
				"se_db":            []model.SpectrumPoint{{X: 10.0, Value: 33.7}},
			})
		case "/optimize":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"n_scanned":   27,
				"n_feasible":  3,
				"candidates":  []any{},
				"sensitivity": nil,
			})
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// newTestServerWithEngine 用临时 SQLite 库 + 指定引擎地址构造 RPC 服务。
func newTestServerWithEngine(
	t *testing.T, authMode mode.AuthMode, transport, engineURL string,
) *Server {
	t.Helper()
	db, err := store.Open(store.Config{
		Driver: store.DriverSQLite,
		DSN:    filepath.Join(t.TempDir(), "rpc.db"),
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := store.Migrate(db, &model.SimulationTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, cerr := db.DB(); cerr == nil {
			_ = sqlDB.Close()
		}
	})
	tasks := task.NewService(task.NewGORMStore(db), task.NewEngineClient(engineURL))
	srv, err := NewServer(tasks, Config{
		AuthMode:        authMode,
		Version:         "test-ver",
		EngineTransport: transport,
	})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	return srv
}

// newTestServer 构造 RPC 服务（自带假引擎）。
func newTestServer(t *testing.T, authMode mode.AuthMode, transport string) *Server {
	t.Helper()
	return newTestServerWithEngine(t, authMode, transport, fakeEngine(t).URL)
}

// line 把请求序列化为**单行** JSON（JSON-Lines 要求每行一个对象，禁止内嵌换行）。
func line(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if bytes.ContainsRune(b, '\n') {
		t.Fatalf("请求含换行，会破坏 JSON-Lines: %s", b)
	}
	return string(b)
}

// request 构造 JSON-RPC 请求对象。
func request(id int, method string, params any) map[string]any {
	r := map[string]any{"jsonrpc": "2.0", "id": id, "method": method}
	if params != nil {
		r["params"] = params
	}
	return r
}

// serve 把若干行请求喂给 Serve，返回解析出的响应列表。
func serve(t *testing.T, s *Server, lines ...string) []Response {
	t.Helper()
	var out bytes.Buffer
	input := strings.Join(lines, "\n") + "\n"
	if err := s.Serve(context.Background(), strings.NewReader(input), &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	var resps []Response
	dec := json.NewDecoder(&out)
	for {
		var r Response
		if err := dec.Decode(&r); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("解析响应失败: %v（原始输出 %s）", err, out.String())
		}
		resps = append(resps, r)
	}
	return resps
}

// resultMap 取响应 result 为 map（断言无错误）。
func resultMap(t *testing.T, r Response) map[string]any {
	t.Helper()
	if r.Error != nil {
		t.Fatalf("期望成功响应，得到错误 %+v", r.Error)
	}
	m, ok := r.Result.(map[string]any)
	if !ok {
		t.Fatalf("result 不是对象: %#v", r.Result)
	}
	return m
}

func TestPingAndMeta(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	resps := serve(t, s,
		line(t, request(1, "ping", nil)),
		line(t, request(2, "meta", nil)),
	)
	if len(resps) != 2 {
		t.Fatalf("响应数 = %d, want 2", len(resps))
	}
	ping := resultMap(t, resps[0])
	if ping["status"] != "ok" || ping["version"] != "test-ver" {
		t.Fatalf("ping = %+v", ping)
	}
	meta := resultMap(t, resps[1])
	if meta["auth_mode"] != "none" || meta["auth_required"] != false {
		t.Fatalf("meta = %+v, want auth_mode=none/auth_required=false", meta)
	}
	if meta["engine_transport"] != "http" || meta["version"] != "test-ver" {
		t.Fatalf("meta = %+v", meta)
	}
}

// getTaskResult 通过 RPC 取任务（返回 result 与 error）。
func getTaskResult(t *testing.T, s *Server, id string) (map[string]any, *Error) {
	t.Helper()
	resp := serve(t, s, line(t, request(9, "tasks.get", map[string]any{"id": id})))[0]
	if resp.Error != nil {
		return nil, resp.Error
	}
	return resultMap(t, resp), nil
}

// waitSucceeded 轮询任务直到 succeeded（假引擎立即返回）。
func waitSucceeded(t *testing.T, s *Server, id string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, rpcErr := getTaskResult(t, s, id)
		if rpcErr != nil {
			t.Fatalf("tasks.get 失败: %+v", rpcErr)
		}
		if res["status"] == string(model.TaskSucceeded) {
			return res
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("任务 %s 未在期限内完成", id)
	return nil
}

// simulateParams 一个合法的正向仿真请求参数。
func simulateParams(name string) map[string]any {
	return map[string]any{
		"name": name,
		"layers": []map[string]any{
			{"material": "ITO", "thickness_nm": 40},
			{"material": "Ag", "thickness_nm": 10},
			{"material": "ITO", "thickness_nm": 40},
		},
	}
}

// TestTaskLifecycleOverStdio 创建 → 查询 → 完成 → 领取结果 → 删除 → 404。
func TestTaskLifecycleOverStdio(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)

	created := resultMap(t, serve(t, s,
		line(t, request(1, "tasks.create", simulateParams("stdio 冒烟"))))[0])
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("创建响应缺少 id: %+v", created)
	}
	if created["user_id"] != "local" {
		t.Fatalf("user_id = %v, want local", created["user_id"])
	}
	if created["status"] != string(model.TaskPending) {
		t.Fatalf("status = %v, want pending", created["status"])
	}

	done := waitSucceeded(t, s, id)
	result, ok := done["result"].(map[string]any)
	if !ok {
		t.Fatalf("结果缺失: %+v", done)
	}
	if rs, _ := result["sheet_resistance"].(float64); rs != 3.9708 {
		t.Fatalf("sheet_resistance = %v, want 3.9708", result["sheet_resistance"])
	}

	// 列表
	list := resultMap(t, serve(t, s, line(t, request(2, "tasks.list", nil)))[0])
	tasks, _ := list["tasks"].([]any)
	if len(tasks) != 1 {
		t.Fatalf("tasks 数 = %d, want 1", len(tasks))
	}

	// 删除 → 再取 404
	delRes := resultMap(t, serve(t, s,
		line(t, request(3, "tasks.delete", map[string]any{"id": id})))[0])
	if delRes["deleted"] != true || delRes["id"] != id {
		t.Fatalf("删除响应异常: %+v", delRes)
	}
	if _, rpcErr := getTaskResult(t, s, id); rpcErr == nil || rpcErr.Code != http.StatusNotFound {
		t.Fatalf("删除后 tasks.get 应 404，得到 %+v", rpcErr)
	}
}

// TestCreateValidationErrors 校验失败 → 400（消息与 HTTP 一致，由 task.CreateRequest 统一产出）。
func TestCreateValidationErrors(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	cases := []struct {
		name    string
		params  map[string]any
		wantMsg string
	}{
		{"空 layers", map[string]any{"layers": []any{}}, "layers 至少需要一层"},
		{"未知 kind", map[string]any{
			"kind":   "scan",
			"layers": []map[string]any{{"material": "ITO", "thickness_nm": 40}},
		}, "kind 必须为 simulate 或 optimize"},
		{"缺 optimize 参数", map[string]any{"kind": "optimize"},
			"optimize 任务需提供 optimize 参数"},
	}
	for _, c := range cases {
		err := serve(t, s, line(t, request(1, "tasks.create", c.params)))[0].Error
		if err == nil || err.Code != http.StatusBadRequest {
			t.Fatalf("%s: 期望 400，得到 %+v", c.name, err)
		}
		if err.Message != c.wantMsg {
			t.Fatalf("%s: 消息 = %q, want %q", c.name, err.Message, c.wantMsg)
		}
	}
}

// TestOptimizeKindOverStdio 反推任务（kind=optimize）在 stdio 下同样可用。
func TestOptimizeKindOverStdio(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	params := map[string]any{
		"kind": "optimize",
		"name": "反推",
		"optimize": map[string]any{
			"target": map[string]any{"min_visible_transmittance": 0.85},
		},
	}
	created := resultMap(t, serve(t, s, line(t, request(1, "tasks.create", params)))[0])
	if created["kind"] != "optimize" {
		t.Fatalf("kind = %v, want optimize", created["kind"])
	}
	id, _ := created["id"].(string)
	done := waitSucceeded(t, s, id)
	if done["optimize_result"] == nil {
		t.Fatalf("optimize_result 缺失: %+v", done)
	}
}

// TestProtocolErrors 协议错误使用 JSON-RPC 保留码。
func TestProtocolErrors(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)

	// 非法 JSON → -32700
	if err := serve(t, s, `{not json`)[0].Error; err == nil || err.Code != codeParseError {
		t.Fatalf("非法 JSON 应 -32700，得到 %+v", err)
	}
	// 未知方法 → -32601
	if err := serve(t, s, line(t, request(1, "nope", nil)))[0].Error; err == nil ||
		err.Code != codeMethodNotFound {
		t.Fatalf("未知方法应 -32601，得到 %+v", err)
	}
	// 参数含未知字段 → -32602（严格解析，避免拼写错误被静默忽略）
	if err := serve(t, s,
		line(t, request(1, "tasks.create", map[string]any{"layer": []any{}})),
	)[0].Error; err == nil || err.Code != codeInvalidParams {
		t.Fatalf("非法参数应 -32602，得到 %+v", err)
	}
	// 缺 method → -32600
	if err := serve(t, s, `{"jsonrpc":"2.0","id":1}`)[0].Error; err == nil ||
		err.Code != codeInvalidRequest {
		t.Fatalf("缺 method 应 -32600，得到 %+v", err)
	}
}

// TestAuthMethodsDisabled stdio 固定单用户：认证方法一律 401（与 HTTP none 模式一致）。
func TestAuthMethodsDisabled(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	for _, m := range []string{"auth.register", "auth.login", "auth.me"} {
		err := serve(t, s, line(t, request(1, m, nil)))[0].Error
		if err == nil || err.Code != http.StatusUnauthorized {
			t.Fatalf("%s 应 401，得到 %+v", m, err)
		}
		if !strings.Contains(err.Message, "auth disabled") {
			t.Fatalf("%s 消息异常: %q", m, err.Message)
		}
	}
}

// TestNotificationNoResponse 无 id 的行是通知：执行但不回复。
func TestNotificationNoResponse(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	var out bytes.Buffer
	if err := s.Serve(context.Background(),
		strings.NewReader(`{"jsonrpc":"2.0","method":"ping"}`+"\n"), &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("通知不应有响应，得到 %s", out.String())
	}
}

// TestNewServerRejectsJWTModes stdio 不支持 jwt 模式（无 HTTP 头可承载 token）。
func TestNewServerRejectsJWTModes(t *testing.T) {
	db, err := store.Open(store.Config{
		Driver: store.DriverSQLite,
		DSN:    filepath.Join(t.TempDir(), "x.db"),
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, cerr := db.DB(); cerr == nil {
			_ = sqlDB.Close()
		}
	})
	tasks := task.NewService(task.NewGORMStore(db), task.NewEngineClient("http://127.0.0.1:1"))
	if _, err := NewServer(tasks, Config{AuthMode: mode.JWT}); err == nil {
		t.Fatal("jwt 模式应被拒绝")
	}
}

// TestLongLineAccepted 大参数（数百 KB）不触发扫描器上限（optimize 报告同理）。
func TestLongLineAccepted(t *testing.T) {
	s := newTestServer(t, mode.None, mode.TransportHTTP)
	longName := strings.Repeat("x", 200_000)
	params := map[string]any{
		"name":   longName,
		"layers": []map[string]any{{"material": "ITO", "thickness_nm": 40}},
	}
	created := resultMap(t, serve(t, s, line(t, request(1, "tasks.create", params)))[0])
	if name, _ := created["name"].(string); len(name) != len(longName) {
		t.Fatalf("长参数被截断: len=%d want %d", len(name), len(longName))
	}
}
