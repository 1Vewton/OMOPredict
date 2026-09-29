package task

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// 本文件覆盖 stdio 引擎传输（T4.5）：
//   - 纯函数：启动命令解析（D9 五级）与命令行切分；
//   - 端到端：用本测试二进制自身充当"假引擎"子进程，验证握手/仿真/反推/错误/超时/退出/关闭。
//
// 未使用 t.Parallel：每个用例都会拉起子进程，且含时序敏感的超时用例。

// 假引擎子进程的环境变量约定。
const (
	helperEnv     = "OMO_TEST_STDIO_HELPER"      // 置 1 时本进程充当假引擎
	helperModeEnv = "OMO_TEST_STDIO_HELPER_MODE" // 行为：error / silent / exit / die_after_ping / echo
)

// TestStdioHelperProcess 充当 StdioEngine 拉起的"假引擎"子进程，不是真正的测试。
//
// 以 os.Exit 结束而非自然返回：否则 testing 框架会把 "PASS"/"ok" 写进 stdout，
// 污染 JSON-Lines 协议流——这正是 docs/api/rpc.md §5 强调的约束。
func TestStdioHelperProcess(t *testing.T) {
	if os.Getenv(helperEnv) != "1" {
		return
	}
	mode := os.Getenv(helperModeEnv)
	if mode == "exit" {
		os.Exit(3) // 模拟引擎启动即崩溃
	}

	reader := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	for {
		line, err := reader.ReadBytes('\n')
		if trimmed := bytes.TrimSpace(line); len(trimmed) > 0 {
			var req struct {
				ID     int64           `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if jerr := json.Unmarshal(trimmed, &req); jerr != nil {
				os.Exit(4) // 协议被污染（例如 stdin 混入了非 JSON 行）
			}
			switch {
			case mode == "silent":
				// 故意不回复：用于超时用例
			case mode == "die_after_ping" && req.Method != "ping":
				os.Exit(0) // 收到业务请求即退出且不回复
			default:
				writeHelperResponse(out, mode, req.ID, req.Method, req.Params)
			}
		}
		if err != nil {
			break
		}
	}
	_ = out.Flush()
	os.Exit(0)
}

// writeHelperResponse 按方法生成假引擎响应（结构与 omo/rpc 一致）。
func writeHelperResponse(out *bufio.Writer, mode string, id int64, method string, params json.RawMessage) {
	var resp map[string]any
	switch {
	case mode == "error" && method == "simulate":
		resp = map[string]any{"jsonrpc": "2.0", "id": id,
			"error": map[string]any{"code": 422, "message": "第 1 层：材料未知"}}
	case mode == "echo" && method == "optimize":
		// 原样回显 params：用于断言 stdio 与 HTTP 的反推载荷逐字节一致
		resp = map[string]any{"jsonrpc": "2.0", "id": id, "result": json.RawMessage(params)}
	case method == "ping":
		resp = map[string]any{"jsonrpc": "2.0", "id": id,
			"result": map[string]any{"status": "ok", "version": "test-helper"}}
	case method == "simulate":
		resp = map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{
			"transmittance":    []map[string]any{{"x": 550.0, "value": 0.9745}},
			"reflectance":      []map[string]any{{"x": 550.0, "value": 0.0201}},
			"sheet_resistance": 3.9708,
			"se_db":            []map[string]any{{"x": 10.0, "value": 33.7}},
		}}
	case method == "optimize":
		resp = map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{
			"n_scanned": 4096, "n_feasible": 12,
			"candidates": []map[string]any{{"fom": 0.61}},
		}}
	default:
		resp = map[string]any{"jsonrpc": "2.0", "id": id,
			"error": map[string]any{"code": -32601, "message": "方法不存在: " + method}}
	}
	payload, _ := json.Marshal(resp)
	_, _ = out.Write(payload)
	_ = out.WriteByte('\n')
	_ = out.Flush()
}

// newHelperEngine 构造指向"假引擎"子进程的 stdio 引擎；timeout <= 0 用 5s。
func newHelperEngine(mode string, timeout time.Duration) *StdioEngine {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	env := []string{helperEnv + "=1"}
	if mode != "" {
		env = append(env, helperModeEnv+"="+mode)
	}
	return NewStdioEngine(EngineCommand{
		Argv:   []string{os.Args[0], "-test.run=TestStdioHelperProcess"},
		Source: "test helper",
		Env:    env,
	}, timeout)
}

// helperStack 与 REST 契约示例一致的 ITO/Ag/ITO 结构。
func helperStack() model.FilmStack {
	return model.FilmStack{Layers: []model.Layer{
		{Material: "ITO", Thickness: 40},
		{Material: "Ag", Thickness: 10},
		{Material: "ITO", Thickness: 40},
	}}
}

func optF64(v float64) *float64 { return &v }

// ---------------------------------------------------------------- 端到端（真实子进程）

func TestStdioEngineSimulate(t *testing.T) {
	engine := newHelperEngine("", 0)
	defer func() { _ = engine.Close() }()

	result, err := engine.Simulate(context.Background(), helperStack())
	if err != nil {
		t.Fatalf("Simulate: %v", err)
	}
	if result.SheetResistance == nil || *result.SheetResistance != 3.9708 {
		t.Fatalf("sheet_resistance = %v, want 3.9708", result.SheetResistance)
	}
	if len(result.Transmittance) != 1 || result.Transmittance[0].X != 550 || result.Transmittance[0].Value != 0.9745 {
		t.Fatalf("transmittance = %+v, want 单点 (550, 0.9745)", result.Transmittance)
	}
	if len(result.SEDB) != 1 || result.SEDB[0].Value != 33.7 {
		t.Fatalf("se_db = %+v, want 单点 33.7", result.SEDB)
	}
}

// TestStdioEngineOptimizePayloadMatchesHTTP 断言 stdio 与 HTTP 的反推载荷逐字节一致
// （假引擎原样回显收到的 params，与 HTTP 侧 json.Marshal(spec) 比较）。
func TestStdioEngineOptimizePayloadMatchesHTTP(t *testing.T) {
	engine := newHelperEngine("echo", 0)
	defer func() { _ = engine.Close() }()

	spec := &model.OptimizeSpec{
		Target: &model.OptimizeTarget{
			MinVisibleTransmittance: optF64(0.85),
			MaxSheetResistance:      optF64(12),
		},
		ComputeSensitivity: func() *bool { b := true; return &b }(),
	}
	got, err := engine.Optimize(context.Background(), spec)
	if err != nil {
		t.Fatalf("Optimize: %v", err)
	}
	want, err := json.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal spec: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("stdio optimize 载荷\n got = %s\nwant = %s（须与 HTTP 一致）", got, want)
	}
}

func TestStdioEngineEngineErrorCode(t *testing.T) {
	engine := newHelperEngine("error", 0)
	defer func() { _ = engine.Close() }()

	_, err := engine.Simulate(context.Background(), helperStack())
	if err == nil {
		t.Fatal("期望引擎返回错误")
	}
	// code 沿用 HTTP 语义，且 detail 透传（与 HTTP 传输的错误可读性一致）
	if !strings.Contains(err.Error(), "code=422") || !strings.Contains(err.Error(), "材料未知") {
		t.Fatalf("错误消息 = %v，want 含 code=422 与引擎 detail", err)
	}
}

func TestStdioEngineTimeout(t *testing.T) {
	engine := newHelperEngine("silent", 300*time.Millisecond)
	defer func() { _ = engine.Close() }()

	start := time.Now()
	_, err := engine.Simulate(context.Background(), helperStack())
	if err == nil {
		t.Fatal("期望超时错误")
	}
	if !strings.Contains(err.Error(), "超时") {
		t.Fatalf("错误消息 = %v，want 含超时", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("超时耗时 %s 过长（时限应为 300ms 量级）", elapsed)
	}
}

// TestStdioEngineProcessExitFailsRequest 验证引擎中途退出时在途请求立即失败（而非挂死到超时）。
func TestStdioEngineProcessExitFailsRequest(t *testing.T) {
	engine := newHelperEngine("die_after_ping", 5*time.Second)
	defer func() { _ = engine.Close() }()

	start := time.Now()
	_, err := engine.Simulate(context.Background(), helperStack())
	if err == nil {
		t.Fatal("期望错误")
	}
	if !strings.Contains(err.Error(), "退出") {
		t.Fatalf("错误消息 = %v，want 含「退出」", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("进程退出未立即失败（耗时 %s）", elapsed)
	}
}

func TestStdioEngineCloseIsIdempotentAndBlocksLaterCalls(t *testing.T) {
	engine := newHelperEngine("", 0)
	if _, err := engine.Simulate(context.Background(), helperStack()); err != nil {
		t.Fatalf("Simulate: %v", err)
	}
	if err := engine.Close(); err != nil {
		t.Fatalf("Close: %v（应能优雅关闭子进程）", err)
	}
	if err := engine.Close(); err != nil {
		t.Fatalf("重复 Close 应幂等: %v", err)
	}
	if _, err := engine.Simulate(context.Background(), helperStack()); err == nil ||
		!strings.Contains(err.Error(), "已关闭") {
		t.Fatalf("关闭后调用应报「已关闭」，得到 %v", err)
	}
}

func TestStdioEngineStartFailureIsReported(t *testing.T) {
	engine := NewStdioEngine(EngineCommand{Argv: []string{"omo-definitely-not-a-real-binary"}}, time.Second)
	defer func() { _ = engine.Close() }()

	if _, err := engine.Simulate(context.Background(), helperStack()); err == nil ||
		!strings.Contains(err.Error(), "启动") {
		t.Fatalf("期望启动失败错误，得到 %v", err)
	}
}

// ---------------------------------------------------------------- 协议层（无需子进程）

// TestDispatchLineCorrelatesByID 覆盖响应乱序到达、未知 id 与非 JSON 行（协议健壮性）。
func TestDispatchLineCorrelatesByID(t *testing.T) {
	engine := &StdioEngine{pending: make(map[int64]chan rpcResult)}
	ch1 := make(chan rpcResult, 1)
	ch2 := make(chan rpcResult, 1)
	engine.pending[1] = ch1
	engine.pending[2] = ch2

	// 故意乱序：id=2 的响应先到
	engine.dispatchLine([]byte(`{"jsonrpc":"2.0","id":2,"result":{"a":1}}` + "\n"))
	engine.dispatchLine([]byte(`{"jsonrpc":"2.0","id":1,"result":{"b":2}}` + "\n"))

	if got := string((<-ch2).resp.Result); got != `{"a":1}` {
		t.Fatalf("id=2 收到 %s，want {\"a\":1}", got)
	}
	if got := string((<-ch1).resp.Result); got != `{"b":2}` {
		t.Fatalf("id=1 收到 %s，want {\"b\":2}", got)
	}
	if len(engine.pending) != 0 {
		t.Fatalf("pending 未清空：%d", len(engine.pending))
	}

	// 以下输入只应记日志，不得 panic 或误投递
	engine.dispatchLine([]byte("这不是 JSON\n"))
	engine.dispatchLine([]byte("\n"))
	engine.dispatchLine([]byte(`{"jsonrpc":"2.0","id":99,"result":{}}` + "\n"))
	engine.dispatchLine([]byte(`{"jsonrpc":"2.0","method":"progress","params":{}}` + "\n"))
}

// ---------------------------------------------------------------- 启动命令解析（D9）

func TestSplitCommandLine(t *testing.T) {
	tests := []struct {
		in      string
		want    []string
		wantErr bool
	}{
		{in: "python -m omo.rpc", want: []string{"python", "-m", "omo.rpc"}},
		{in: `  python   -m   omo.rpc  `, want: []string{"python", "-m", "omo.rpc"}},
		{in: `"C:\Program Files\Python312\python.exe" -m omo.rpc`,
			want: []string{`C:\Program Files\Python312\python.exe`, "-m", "omo.rpc"}},
		{in: `"/opt/omo rpc/omo-rpc" --flag`, want: []string{"/opt/omo rpc/omo-rpc", "--flag"}},
		{in: `"C:\dev\"quoted\python.exe"`, want: []string{`C:\dev"quoted\python.exe`}},
		{in: "", want: nil},
		{in: `python "unclosed`, wantErr: true},
	}
	for _, c := range tests {
		got, err := splitCommandLine(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("splitCommandLine(%q) 期望报错，得到 %v", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("splitCommandLine(%q): %v", c.in, err)
			continue
		}
		if strings.Join(got, "\x00") != strings.Join(c.want, "\x00") {
			t.Errorf("splitCommandLine(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestResolveEngineCommand 覆盖 D9 五级发现顺序（注入环境，不触碰真实机器）。
func TestResolveEngineCommand(t *testing.T) {
	base := t.TempDir()
	project := filepath.Join(base, "resources", "engine")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := os.WriteFile(filepath.Join(project, "pyproject.toml"), []byte("[project]\n"), 0o600); err != nil {
		t.Fatalf("write pyproject: %v", err)
	}

	// 完整包 sidecar（平台相关文件名）
	sidecarDir := t.TempDir()
	sidecarProject := filepath.Join(sidecarDir, "resources", "engine")
	if err := os.MkdirAll(sidecarProject, 0o755); err != nil {
		t.Fatalf("mkdir sidecar project: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sidecarProject, "pyproject.toml"), []byte("[project]\n"), 0o600); err != nil {
		t.Fatalf("write sidecar pyproject: %v", err)
	}
	sidecarName := "omo-rpc"
	if runtime.GOOS == "windows" {
		sidecarName = "omo-rpc.exe"
	}
	sidecarPath := filepath.Join(sidecarProject, sidecarName)
	if err := os.WriteFile(sidecarPath, []byte("stub"), 0o600); err != nil {
		t.Fatalf("write sidecar: %v", err)
	}

	newEnv := func(vars map[string]string, exeDir string, paths map[string]string) ResolveEnv {
		return ResolveEnv{
			Getenv: func(k string) string { return vars[k] },
			LookPath: func(name string) (string, error) {
				if p, ok := paths[name]; ok {
					return p, nil
				}
				return "", errors.New("not found in PATH")
			},
			Stat:   os.Stat,
			ExeDir: exeDir,
		}
	}

	tests := []struct {
		name       string
		env        ResolveEnv
		wantArgv   []string
		wantDir    string
		wantSource string
		wantErr    error
	}{
		{
			name:       "1 显式 OMO_ENGINE_CMD 优先（含引号路径）",
			env:        newEnv(map[string]string{"OMO_ENGINE_CMD": `"C:\Py 3.12\python.exe" -m omo.rpc`}, base, map[string]string{"uv": "/usr/bin/uv"}),
			wantArgv:   []string{`C:\Py 3.12\python.exe`, "-m", "omo.rpc"},
			wantSource: "OMO_ENGINE_CMD",
		},
		{
			name:       "2 sidecar（完整包）",
			env:        newEnv(nil, sidecarDir, map[string]string{"uv": "/usr/bin/uv"}),
			wantArgv:   []string{sidecarPath},
			wantDir:    sidecarProject,
			wantSource: "resources/engine sidecar",
		},
		{
			name:       "3 uv + 引擎工程",
			env:        newEnv(nil, base, map[string]string{"uv": "/usr/bin/uv"}),
			wantArgv:   []string{"/usr/bin/uv", "run", "--frozen", "--project", project, "python", "-m", "omo.rpc"},
			wantDir:    project,
			wantSource: "uv + 引擎工程目录",
		},
		{
			name:       "4 系统 python 兜底",
			env:        newEnv(nil, base, map[string]string{"python": "/usr/bin/python"}),
			wantArgv:   []string{"/usr/bin/python", "-m", "omo.rpc"},
			wantDir:    project,
			wantSource: "PATH 上的 python",
		},
		{
			name:     "5 全部失败",
			env:      newEnv(nil, "", nil),
			wantErr:  ErrEngineNotFound,
			wantArgv: nil,
		},
	}

	for _, c := range tests {
		t.Run(c.name, func(t *testing.T) {
			got, err := ResolveEngineCommand(c.env)
			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("err = %v, want %v", err, c.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveEngineCommand: %v", err)
			}
			if strings.Join(got.Argv, "\x00") != strings.Join(c.wantArgv, "\x00") {
				t.Fatalf("Argv = %q, want %q", got.Argv, c.wantArgv)
			}
			if got.Dir != c.wantDir {
				t.Fatalf("Dir = %q, want %q", got.Dir, c.wantDir)
			}
			if got.Source != c.wantSource {
				t.Fatalf("Source = %q, want %q", got.Source, c.wantSource)
			}
		})
	}
}

// TestResolveEngineCommandRejectsBadCmd 显式命令非法时应报错而不是静默回退。
func TestResolveEngineCommandRejectsBadCmd(t *testing.T) {
	env := ResolveEnv{
		Getenv:   func(string) string { return `python "unclosed` },
		LookPath: func(string) (string, error) { return "/usr/bin/python", nil },
		Stat:     os.Stat,
	}
	if _, err := ResolveEngineCommand(env); err == nil {
		t.Fatal("引号未闭合的 OMO_ENGINE_CMD 应报错（不得静默回退到其它级别）")
	}
}

// TestSimulateParamsDefaults 固化衬底默认值：未指定时按 1.5 发送（与引擎默认一致），
// 该函数由 HTTP 与 stdio 两种传输共用，是"载荷一致"的结构性保证。
func TestSimulateParamsDefaults(t *testing.T) {
	raw, err := simulateParams(model.FilmStack{Layers: []model.Layer{{Material: "Ag", Thickness: 10}}})
	if err != nil {
		t.Fatalf("simulateParams: %v", err)
	}
	var got struct {
		Layers         []model.Layer `json:"layers"`
		SubstrateIndex float64       `json:"substrate_index"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.SubstrateIndex != 1.5 {
		t.Fatalf("substrate_index = %v, want 1.5（引擎默认）", got.SubstrateIndex)
	}
	if len(got.Layers) != 1 || got.Layers[0].Material != "Ag" || got.Layers[0].Thickness != 10 {
		t.Fatalf("layers = %+v", got.Layers)
	}

	// 显式指定时应透传
	raw, err = simulateParams(model.FilmStack{
		Layers:         []model.Layer{{Material: "Ag", Thickness: 10}},
		SubstrateIndex: 1.46,
	})
	if err != nil {
		t.Fatalf("simulateParams: %v", err)
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.SubstrateIndex != 1.46 {
		t.Fatalf("substrate_index = %v, want 1.46", got.SubstrateIndex)
	}
}
