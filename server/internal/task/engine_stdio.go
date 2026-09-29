// stdio JSON-RPC 引擎传输（桌面形态）：Go 作为父进程拉起 Python 引擎，走 stdin/stdout 行协议。
//
// 契约：JSON-RPC 2.0 + 换行分隔（JSON-Lines）+ UTF-8，与 `omo/rpc`（引擎侧实现）
// 及 `internal/rpc`（Electron↔Go）同族。方法与 HTTP 端点一一对应：
//
//	`ping`     ↔ GET  /health
//	`simulate` ↔ POST /simulate
//	`optimize` ↔ POST /optimize
//
// 且 params/result **逐字段相同**（本文件与 EngineClient 共用 simulateParams 等构造，
// 契约见 docs/api/engine.md）。
//
// 为什么需要它：桌面形态要求"运行期不监听任何端口"（docs/desktop.md D11/§10.6）。
// HTTP 传输会强制引擎以 uvicorn 监听端口，并连带把 FastAPI/uvicorn 打进安装包；
// stdio 传输下引擎是纯子进程，无端口、无 HTTP 依赖（D4）。
package task

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// DefaultEngineTimeout 单次引擎调用超时；与 HTTP 传输的 60s 客户端超时保持一致。
const DefaultEngineTimeout = 60 * time.Second

// engineRestartMinInterval 两次引擎启动之间的最小间隔：引擎反复崩溃时避免 spawn 风暴。
// （周期性健康检查与"3 次/10min"上限属 Host 层职责，见 docs/desktop.md D5/T6。）
const engineRestartMinInterval = 3 * time.Second

// rpcRequest JSON-RPC 2.0 请求（与 omo/rpc 对齐）。
type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// rpcResponse JSON-RPC 2.0 响应；ID 为 nil 表示通知（本客户端不消费）。
type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// rpcError 引擎返回的错误；code 沿用 HTTP 状态码语义（如 422 = 领域校验失败）。
type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// rpcResult 单次调用的结果：resp 为引擎响应，err 为本地错误（进程退出/客户端关闭等）。
type rpcResult struct {
	resp rpcResponse
	err  error
}

// StdioEngine 通过 stdio JSON-RPC 调用 Python 引擎（`python -m omo.rpc`）。
//
// 并发安全：多个任务 goroutine 可同时调用；请求按自增 id 关联响应，由单个读循环分发。
// 子进程**惰性启动**（首次调用时），启动后立即 ping 一次确认协议可用。
type StdioEngine struct {
	command EngineCommand
	timeout time.Duration

	mu        sync.Mutex
	writeMu   sync.Mutex     // 串行化管道写入（不持有 mu，避免写阻塞拖死 Close）
	proc      *exec.Cmd      // 当前子进程（nil = 未启动或已退出）
	stdin     io.WriteCloser // 子进程 stdin（协议写端）
	genDone   chan struct{}  // 当前子进程退出信号（读循环 + Wait 完成）
	pending   map[int64]chan rpcResult
	nextID    int64
	lastStart time.Time
	closed    bool
}

// NewStdioEngine 构造 stdio 引擎客户端；timeout <= 0 时用 DefaultEngineTimeout。
func NewStdioEngine(command EngineCommand, timeout time.Duration) *StdioEngine {
	if timeout <= 0 {
		timeout = DefaultEngineTimeout
	}
	return &StdioEngine{
		command: command,
		timeout: timeout,
		pending: make(map[int64]chan rpcResult),
	}
}

// Simulate 正向仿真（引擎 RPC `simulate`；载荷与 POST /simulate 逐字段一致）。
func (s *StdioEngine) Simulate(ctx context.Context, stack model.FilmStack) (*model.TaskResult, error) {
	payload, err := simulateParams(stack)
	if err != nil {
		return nil, err
	}
	raw, err := s.invoke(ctx, "simulate", payload)
	if err != nil {
		return nil, err
	}
	var out engineResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("task: decode simulate result: %w", err)
	}
	return &model.TaskResult{
		Transmittance:   out.Transmittance,
		Reflectance:     out.Reflectance,
		SheetResistance: out.SheetResistance,
		SEDB:            out.SEDB,
	}, nil
}

// Optimize 目标反推（引擎 RPC `optimize`）；报告 JSON 原样返回、不解析内容
// （与 HTTP 传输一致，由 Go 侧注入 task_id 后持久化）。
func (s *StdioEngine) Optimize(ctx context.Context, spec *model.OptimizeSpec) (json.RawMessage, error) {
	if spec == nil {
		return nil, errors.New("task: optimize spec 为 nil")
	}
	payload, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("task: marshal optimize request: %w", err)
	}
	raw, err := s.invoke(ctx, "optimize", payload)
	if err != nil {
		return nil, err
	}
	if !json.Valid(raw) {
		return nil, errors.New("task: 引擎 optimize 返回非法 JSON")
	}
	return json.RawMessage(raw), nil
}

// Close 优雅关闭引擎：关闭 stdin（引擎读到 EOF 后自行退出），超时 3s 后强杀，
// 保证退出后无残留子进程（docs/desktop.md D5）。
func (s *StdioEngine) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	proc, stdin, genDone := s.proc, s.stdin, s.genDone
	s.proc, s.stdin, s.genDone = nil, nil, nil
	s.failPendingLocked(errors.New("engine: 客户端已关闭"))
	s.mu.Unlock()

	if proc == nil {
		return nil
	}
	if stdin != nil {
		_ = stdin.Close()
	}
	select {
	case <-genDone:
		return nil
	case <-time.After(3 * time.Second):
		_ = proc.Process.Kill()
		<-genDone
		return errors.New("task: 引擎未在 3s 内退出，已强制终止")
	}
}

// ---------------------------------------------------------------- 内部实现

// invoke 确保引擎就绪后发送一次请求。
func (s *StdioEngine) invoke(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	if err := s.ensureStarted(ctx); err != nil {
		return nil, err
	}
	return s.call(ctx, method, params)
}

// ensureStarted 确保子进程就绪；若本次才启动，则 ping 一次确认协议可用
// （把"引擎装错/缺依赖"这类问题暴露在首次调用处，而不是让任务静默超时）。
func (s *StdioEngine) ensureStarted(ctx context.Context) error {
	s.mu.Lock()
	needPing := s.proc == nil
	err := s.startLocked()
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if !needPing {
		return nil
	}
	if _, err := s.call(ctx, "ping", json.RawMessage(`{}`)); err != nil {
		return fmt.Errorf("engine: 启动后 ping 失败: %w", err)
	}
	return nil
}

// startLocked 启动子进程并开启读循环；调用方必须持有 s.mu。
func (s *StdioEngine) startLocked() error {
	if s.closed {
		return errors.New("engine: 客户端已关闭")
	}
	if s.proc != nil {
		return nil
	}
	if !s.lastStart.IsZero() {
		if waited := time.Since(s.lastStart); waited < engineRestartMinInterval {
			return fmt.Errorf("engine: 启动过于频繁（距上次启动 %s，最小间隔 %s）",
				waited.Round(time.Millisecond), engineRestartMinInterval)
		}
	}
	if len(s.command.Argv) == 0 {
		return errors.New("engine: 启动命令为空")
	}

	cmd := exec.Command(s.command.Argv[0], s.command.Argv[1:]...)
	if s.command.Dir != "" {
		cmd.Dir = s.command.Dir
	}
	if len(s.command.Env) > 0 {
		cmd.Env = append(os.Environ(), s.command.Env...)
	}
	// stdout 是协议流（只允许 JSON-RPC 行）；引擎日志必须走 stderr，并入本进程 stderr。
	cmd.Stderr = os.Stderr

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("engine: 获取 stdin 管道: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("engine: 获取 stdout 管道: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("engine: 启动 %v: %w", s.command.Argv, err)
	}

	genDone := make(chan struct{})
	s.proc, s.stdin, s.genDone = cmd, stdin, genDone
	s.lastStart = time.Now()
	go s.runGeneration(cmd, stdout, genDone)
	return nil
}

// runGeneration 读取一代子进程的全部响应，直到 stdout EOF，然后回收进程。
func (s *StdioEngine) runGeneration(cmd *exec.Cmd, stdout io.Reader, genDone chan struct{}) {
	defer close(genDone)
	reader := bufio.NewReaderSize(stdout, 64*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			s.dispatchLine(line)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("engine stdio: 读循环结束: %v", err)
			}
			break
		}
	}
	s.generationEnded(cmd, cmd.Wait())
}

// dispatchLine 解析一行响应并按 id 投递给等待方（未知 id/非法行只记日志，不致命）。
func (s *StdioEngine) dispatchLine(line []byte) {
	var resp rpcResponse
	if err := json.Unmarshal(bytes.TrimSpace(line), &resp); err != nil {
		log.Printf("engine stdio: 忽略非 JSON 行（%d 字节）: %v", len(line), err)
		return
	}
	if resp.ID == nil {
		return // 通知；本客户端不消费
	}
	s.mu.Lock()
	ch := s.pending[*resp.ID]
	delete(s.pending, *resp.ID)
	s.mu.Unlock()
	if ch == nil {
		log.Printf("engine stdio: 收到未知 id 的响应（id=%d）", *resp.ID)
		return
	}
	ch <- rpcResult{resp: resp} // 缓冲为 1，不会阻塞读循环
}

// generationEnded 在一代子进程退出后清理状态，并让所有在途请求立即失败。
func (s *StdioEngine) generationEnded(cmd *exec.Cmd, waitErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.proc != cmd {
		return // 已被更新的一代取代，或 Close 已清理
	}
	s.proc, s.stdin, s.genDone = nil, nil, nil
	if waitErr != nil {
		s.failPendingLocked(fmt.Errorf("engine: 引擎进程异常退出: %w", waitErr))
		return
	}
	s.failPendingLocked(errors.New("engine: 引擎进程已退出"))
}

// failPendingLocked 让所有在途请求立即失败；调用方必须持有 s.mu。
func (s *StdioEngine) failPendingLocked(err error) {
	for id, ch := range s.pending {
		delete(s.pending, id)
		ch <- rpcResult{err: err}
	}
}

// forget 撤销一个在途请求（超时/取消/写失败后调用）。
func (s *StdioEngine) forget(id int64) {
	s.mu.Lock()
	delete(s.pending, id)
	s.mu.Unlock()
}

// call 发送请求并等待响应；不负责启动进程（调用方先 ensureStarted）。
//
// 写入在 writeMu 下进行而**不持有 mu**：即便引擎卡住导致管道写阻塞，Close()
// 仍能拿到 mu 并关闭 stdin（阻塞的写会随即报错返回），不会互相僵死。
func (s *StdioEngine) call(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, errors.New("engine: 客户端已关闭")
	}
	stdin := s.stdin
	if stdin == nil {
		s.mu.Unlock()
		return nil, errors.New("engine: 引擎未启动")
	}
	s.nextID++
	id := s.nextID
	s.mu.Unlock()

	line, err := json.Marshal(rpcRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params})
	if err != nil {
		return nil, fmt.Errorf("task: marshal rpc request: %w", err)
	}
	line = append(line, '\n')

	// 先注册等待者再写入：响应只可能在写入之后产生，且读循环在另一个 goroutine。
	reply := make(chan rpcResult, 1)
	s.mu.Lock()
	if s.closed || s.stdin == nil {
		s.mu.Unlock()
		return nil, errors.New("engine: 客户端已关闭")
	}
	stdin = s.stdin
	s.pending[id] = reply
	s.mu.Unlock()

	s.writeMu.Lock()
	_, werr := stdin.Write(line)
	s.writeMu.Unlock()
	if werr != nil {
		s.forget(id)
		return nil, fmt.Errorf("engine: 写入 %s 请求失败: %w", method, werr)
	}

	timer := time.NewTimer(s.timeout)
	defer timer.Stop()
	select {
	case res := <-reply:
		if res.err != nil {
			return nil, res.err
		}
		if res.resp.Error != nil {
			return nil, fmt.Errorf("engine %s: %s (code=%d)",
				method, res.resp.Error.Message, res.resp.Error.Code)
		}
		return res.resp.Result, nil
	case <-timer.C:
		s.forget(id)
		return nil, fmt.Errorf("engine: %s 响应超时（%s）", method, s.timeout)
	case <-ctx.Done():
		s.forget(id)
		return nil, fmt.Errorf("engine: %s 调用被取消: %w", method, ctx.Err())
	}
}
