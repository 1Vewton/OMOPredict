package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/task"
)

// fakeEngine 模拟 Python 引擎 /simulate 与 /optimize（fail=true 时均返回 422）。
func fakeEngine(t *testing.T, fail bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if fail {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"detail":"unknown material: SiO2"}`))
			return
		}
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
				"n_scanned":       4096,
				"n_feasible":      3,
				"elapsed_seconds": 0.1,
				"candidates": []map[string]any{{
					"thicknesses_nm":        []float64{52, 8, 56},
					"visible_transmittance": 0.9643,
					"sheet_resistance":      4.75,
					"se_min_db":             32.19,
					"se_band_ghz":           []float64{8.2, 12.4},
					"fom":                   0.14656,
				}},
				"best_effort": nil,
				"sensitivity": map[string]any{
					"layers": []map[string]any{{
						"layer_index": 1, "material": "Ag", "thickness_nm": 8.0,
						"dfom_rel_per_nm": -0.0091, "dt_abs_per_nm": -0.01371,
						"dlog10_rs_per_nm": -0.0579, "tolerance_nm": 4.5,
					}},
				},
			})
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// newTestTaskService 用临时 SQLite 库 + 指定引擎地址构造任务服务。
func newTestTaskService(t *testing.T, engineURL string) *task.Service {
	t.Helper()
	db, err := store.Open(store.Config{
		Driver: store.DriverSQLite,
		DSN:    filepath.Join(t.TempDir(), "tasks.db"),
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
	return task.NewService(task.NewGORMStore(db), task.NewEngineClient(engineURL))
}

// newTestRouter 组装完整路由（假引擎 + 临时库）。
func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	return NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, false).URL))
}

// registerAndLogin 注册并登录，返回 token。
func registerAndLogin(t *testing.T, router http.Handler, username string) string {
	t.Helper()
	reg := httptest.NewRequest(http.MethodPost, "/api/auth/register",
		strings.NewReader(`{"username":"`+username+`","password":"secret123"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, reg)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body=%s", rec.Code, rec.Body.String())
	}
	login := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"`+username+`","password":"secret123"}`))
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, login)
	if rec2.Code != http.StatusOK {
		t.Fatalf("login status = %d", rec2.Code)
	}
	var lr loginResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &lr); err != nil || lr.Token == "" {
		t.Fatalf("login response invalid: %v", err)
	}
	return lr.Token
}

// waitForTask 轮询任务直到达到目标状态（异步执行用）。
func waitForTask(t *testing.T, router http.Handler, token, id string, want model.TaskStatus) *model.SimulationTask {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodGet, "/api/tasks/"+id, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get task status = %d, body=%s", rec.Code, rec.Body.String())
		}
		var out model.SimulationTask
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode task: %v", err)
		}
		if out.Status == want {
			return &out
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("任务 %s 未在期限内到达 %s", id, want)
	return nil
}

// postTask 带 token 创建任务。
func postTask(t *testing.T, router http.Handler, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func itoAgItoBody() string {
	return `{"name":"demo","layers":[
		{"material":"ITO","thickness_nm":40},
		{"material":"Ag","thickness_nm":10},
		{"material":"ITO","thickness_nm":40}]}`
}

func TestTaskFlow(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")

	rec := postTask(t, router, token, itoAgItoBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create task status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var created model.SimulationTask
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.ID == "" || created.Status != model.TaskPending {
		t.Fatalf("unexpected created: %+v", created)
	}

	done := waitForTask(t, router, token, created.ID, model.TaskSucceeded)
	if done.Result == nil {
		t.Fatal("结果为空")
	}
	if done.Result.SheetResistance == nil || *done.Result.SheetResistance != 3.9708 {
		t.Fatalf("sheet_resistance = %v, want 3.9708", done.Result.SheetResistance)
	}
	if len(done.Result.Transmittance) != 1 || done.Result.Transmittance[0].Value != 0.9745 {
		t.Fatalf("transmittance 异常: %+v", done.Result.Transmittance)
	}
	if done.Result.TaskID != created.ID {
		t.Fatalf("result task_id = %q, want %q", done.Result.TaskID, created.ID)
	}
}

func TestTaskEngineFailure(t *testing.T) {
	// 引擎返回 422 → 任务 failed 且带错误消息
	router := NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, true).URL))
	token := registerAndLogin(t, router, "bob")

	rec := postTask(t, router, token, itoAgItoBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create task status = %d", rec.Code)
	}
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	done := waitForTask(t, router, token, created.ID, model.TaskFailed)
	if !strings.Contains(done.Error, "SiO2") {
		t.Fatalf("错误消息缺少 SiO2: %q", done.Error)
	}
}

func TestTaskOwnership(t *testing.T) {
	router := newTestRouter(t)
	tokenA := registerAndLogin(t, router, "alice")
	tokenB := registerAndLogin(t, router, "bob")

	rec := postTask(t, router, tokenA, itoAgItoBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	// bob 访问 alice 的任务 → 404（不泄露存在性）
	reqB := httptest.NewRequest(http.MethodGet, "/api/tasks/"+created.ID, nil)
	reqB.Header.Set("Authorization", "Bearer "+tokenB)
	recB := httptest.NewRecorder()
	router.ServeHTTP(recB, reqB)
	if recB.Code != http.StatusNotFound {
		t.Fatalf("cross-user status = %d, want 404", recB.Code)
	}

	// alice 自己可访问
	reqA := httptest.NewRequest(http.MethodGet, "/api/tasks/"+created.ID, nil)
	reqA.Header.Set("Authorization", "Bearer "+tokenA)
	recA := httptest.NewRecorder()
	router.ServeHTTP(recA, reqA)
	if recA.Code != http.StatusOK {
		t.Fatalf("owner status = %d, want 200", recA.Code)
	}
}

func TestTaskList(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")

	for i := 0; i < 2; i++ {
		rec := postTask(t, router, token, itoAgItoBody())
		if rec.Code != http.StatusAccepted {
			t.Fatalf("create #%d status = %d", i, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var out taskListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(out.Tasks) != 2 {
		t.Fatalf("任务数 = %d, want 2", len(out.Tasks))
	}
}

func TestCreateTaskEmptyLayers(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", strings.NewReader(`{"layers":[]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty layers status = %d, want 400", rec.Code)
	}
}

func TestTaskUnauthorized(t *testing.T) {
	router := newTestRouter(t)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/tasks",
		strings.NewReader(itoAgItoBody())))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token status = %d, want 401", rec.Code)
	}
}

func optimizeTaskBody() string {
	return `{"kind":"optimize","name":"design-1","optimize":{
		"target":{"min_visible_transmittance":0.85,"max_sheet_resistance":12.0,"min_se_db":25.0},
		"space":{"outer_bounds_nm":[20,80],"outer_step_nm":4.0,
		         "metal_bounds_nm":[5,20],"metal_step_nm":1.0},
		"compute_sensitivity":true}}`
}

// TestOptimizeTaskFlow kind=optimize：202 → 轮询 succeeded → optimize_result 为引擎报告 JSON。
func TestOptimizeTaskFlow(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")

	rec := postTask(t, router, token, optimizeTaskBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create optimize task status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var created model.SimulationTask
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.Kind != model.TaskKindOptimize || created.Optimize == nil {
		t.Fatalf("created 应带 kind=optimize 与 optimize 参数: %+v", created)
	}

	done := waitForTask(t, router, token, created.ID, model.TaskSucceeded)
	if done.Kind != model.TaskKindOptimize {
		t.Fatalf("task kind = %q, want optimize", done.Kind)
	}
	if len(done.OptimizeResult) == 0 {
		t.Fatal("optimize_result 为空")
	}
	var report struct {
		TaskID      string           `json:"task_id"`
		NScanned    int              `json:"n_scanned"`
		NFeasible   int              `json:"n_feasible"`
		Candidates  []map[string]any `json:"candidates"`
		Sensitivity *struct {
			Layers []map[string]any `json:"layers"`
		} `json:"sensitivity"`
	}
	if err := json.Unmarshal(done.OptimizeResult, &report); err != nil {
		t.Fatalf("optimize_result 非法 JSON: %v", err)
	}
	if report.TaskID != created.ID {
		t.Fatalf("result task_id = %q, want %q", report.TaskID, created.ID)
	}
	if report.NScanned != 4096 || len(report.Candidates) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if report.Sensitivity == nil || len(report.Sensitivity.Layers) != 1 {
		t.Fatalf("sensitivity 缺失: %+v", report.Sensitivity)
	}
	top := report.Candidates[0]
	if top["fom"].(float64) != 0.14656 {
		t.Fatalf("top candidate fom = %v", top["fom"])
	}
}

func TestOptimizeTaskMissingSpec(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")
	rec := postTask(t, router, token, `{"kind":"optimize"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing optimize status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestCreateTaskUnknownKind(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")
	rec := postTask(t, router, token, `{"kind":"scan","layers":[{"material":"ITO","thickness_nm":40}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown kind status = %d, want 400", rec.Code)
	}
}

func TestOptimizeTaskEngineFailure(t *testing.T) {
	router := NewRouter(newTestService(t), newTestTaskService(t, fakeEngine(t, true).URL))
	token := registerAndLogin(t, router, "bob")
	rec := postTask(t, router, token, optimizeTaskBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("create optimize task status = %d", rec.Code)
	}
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	done := waitForTask(t, router, token, created.ID, model.TaskFailed)
	if !strings.Contains(done.Error, "SiO2") {
		t.Fatalf("错误消息缺少 SiO2: %q", done.Error)
	}
}

// TestTaskSimulateKindDefault 兼容：不带 kind 的任务按 simulate 处理。
func TestTaskSimulateKindDefault(t *testing.T) {
	router := newTestRouter(t)
	token := registerAndLogin(t, router, "alice")
	rec := postTask(t, router, token, itoAgItoBody())
	var created model.SimulationTask
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Kind != model.TaskKindSimulate {
		t.Fatalf("缺省 kind = %q, want simulate", created.Kind)
	}
}
