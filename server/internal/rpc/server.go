// Package rpc 提供 stdio JSON-RPC 2.0 服务（桌面版传输，docs/desktop.md D11）。
//
// 协议：JSON-Lines —— 每行一个 JSON-RPC 对象，UTF-8 字节流（不经控制台代码页，避免 GBK 干扰）。
//
//	请求：{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{...}}
//	成功：{"jsonrpc":"2.0","id":1,"result":{...}}
//	失败：{"jsonrpc":"2.0","id":1,"error":{"code":400,"message":"layers 至少需要一层"}}
//
// 契约：方法参数与结果同 HTTP 端点逐字段一致（docs/api/rpc.md ↔ docs/api/rest.md），
// 因此两种传输可用同一套契约测试互相验证。
//
// 错误码：应用错误沿用 HTTP 状态码语义（400/401/404/409/500）；
// 协议错误使用 JSON-RPC 保留码（-32700 解析失败 / -32600 非法请求 / -32601 方法不存在 / -32602 参数非法）。
package rpc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/1Vewton/OMOPredict/server/internal/mode"
	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/task"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

// JSON-RPC 协议保留错误码。
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// maxLineBytes 单行上限（optimize 报告可达数百 KB，留足余量）。
const maxLineBytes = 16 << 20 // 16 MiB

// Request JSON-RPC 请求。
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Error JSON-RPC 错误体（code 沿用 HTTP 状态码语义，见包注释）。
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Response JSON-RPC 响应。
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

// Config RPC 服务配置（与 api.Config 同源，由 main 统一构造）。
type Config struct {
	// AuthMode 仅支持 mode.None：stdio 传输没有 HTTP 头，无法承载 Bearer token，
	// 桌面版固定为单用户本地模式（docs/desktop.md D10）。
	AuthMode mode.AuthMode
	// Version 服务版本（供 ping/meta 返回与日志）。
	Version string
	// EngineTransport 引擎传输方式（本阶段 Go→引擎 仍走 HTTP，见 T4）。
	EngineTransport string
}

// Server stdio JSON-RPC 服务：方法路由复用 task 服务层（与 HTTP handler 同一实现来源）。
//
// 说明：stdio 传输固定为单用户本地模式，因此不注入 user 服务——认证相关方法
// 一律返回 401（与 HTTP none 模式行为一致）。
type Server struct {
	tasks *task.Service
	cfg   Config
}

// NewServer 构造 stdio RPC 服务。
//
// 异常:
//   - AuthMode 非 none（stdio 无法承载 token；请在桌面模式使用 OMO_AUTH_MODE=none）
func NewServer(tasks *task.Service, cfg Config) (*Server, error) {
	if cfg.AuthMode != mode.None {
		return nil, fmt.Errorf(
			"rpc: stdio 传输仅支持 OMO_AUTH_MODE=none（当前 %q）", cfg.AuthMode,
		)
	}
	if cfg.EngineTransport == "" {
		cfg.EngineTransport = mode.TransportHTTP
	}
	return &Server{tasks: tasks, cfg: cfg}, nil
}

// Serve 逐行读取请求、逐行写回响应，直到 in 结束（EOF）或读写失败。
//
// 无 id 的行视为通知：执行但不回复（JSON-RPC 2.0）。
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineBytes)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		resp := s.handleLine(ctx, line)
		if resp == nil {
			continue // 通知：不回复
		}
		if err := enc.Encode(resp); err != nil {
			return fmt.Errorf("rpc: 写响应失败: %w", err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("rpc: 读请求失败: %w", err)
	}
	return nil
}

// handleLine 处理一行请求；返回 nil 表示通知（不回复）。
func (s *Server) handleLine(ctx context.Context, line []byte) *Response {
	var req Request
	if err := json.Unmarshal(line, &req); err != nil {
		return &Response{JSONRPC: "2.0", Error: &Error{
			Code: codeParseError, Message: "解析失败: " + err.Error(),
		}}
	}
	if req.Method == "" {
		return &Response{JSONRPC: "2.0", ID: req.ID, Error: &Error{
			Code: codeInvalidRequest, Message: "缺少 method",
		}}
	}

	result, rpcErr := s.dispatch(ctx, req.Method, req.Params)
	if len(req.ID) == 0 {
		return nil // 通知：无响应
	}
	resp := &Response{JSONRPC: "2.0", ID: req.ID}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return resp
}

// dispatch 方法路由（参数/结果与 HTTP 契约一致，见 docs/api/rpc.md）。
func (s *Server) dispatch(ctx context.Context, method string, params json.RawMessage) (any, *Error) {
	switch method {
	case "ping":
		return map[string]string{"status": "ok", "version": s.cfg.Version}, nil

	case "meta":
		return mode.NewMeta(s.cfg.Version, s.cfg.AuthMode, s.cfg.EngineTransport), nil

	case "tasks.create":
		var req task.CreateRequest
		if err := decodeParams(params, &req); err != nil {
			return nil, err
		}
		in, err := req.ToInput()
		if err != nil {
			return nil, appError(http.StatusBadRequest, err.Error())
		}
		created, err := s.tasks.Create(ctx, user.LocalUserID, in)
		if err != nil {
			return nil, appError(http.StatusInternalServerError, err.Error())
		}
		return created, nil

	case "tasks.list":
		list, err := s.tasks.List(ctx, user.LocalUserID)
		if err != nil {
			return nil, appError(http.StatusInternalServerError, err.Error())
		}
		return taskListPayload{Tasks: list}, nil

	case "tasks.get":
		var p taskIDParams
		if err := decodeParams(params, &p); err != nil {
			return nil, err
		}
		if p.ID == "" {
			return nil, appError(http.StatusBadRequest, "缺少 id")
		}
		t, err := s.tasks.GetOwned(ctx, user.LocalUserID, p.ID)
		if err != nil {
			return nil, taskError(err)
		}
		return t, nil

	case "tasks.delete":
		var p taskIDParams
		if err := decodeParams(params, &p); err != nil {
			return nil, err
		}
		if p.ID == "" {
			return nil, appError(http.StatusBadRequest, "缺少 id")
		}
		if err := s.tasks.DeleteOwned(ctx, user.LocalUserID, p.ID); err != nil {
			return nil, taskError(err)
		}
		return deletePayload{ID: p.ID, Deleted: true}, nil

	case "auth.register", "auth.login", "auth.me":
		// stdio 传输固定单用户本地模式：与 HTTP none 模式行为一致
		return nil, appError(http.StatusUnauthorized, "auth disabled in single-user (local) mode")

	default:
		return nil, &Error{Code: codeMethodNotFound, Message: "方法不存在: " + method}
	}
}

// taskIDParams tasks.get / tasks.delete 参数（HTTP 用路径参数，RPC 用 {"id": "..."}）。
type taskIDParams struct {
	ID string `json:"id"`
}

// taskListPayload tasks.list 结果（与 HTTP GET /api/tasks 同结构）。
type taskListPayload struct {
	Tasks []model.SimulationTask `json:"tasks"`
}

// deletePayload tasks.delete 结果（与 HTTP DELETE 同结构）。
type deletePayload struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// decodeParams 解析方法参数；params 为空视为空对象。
func decodeParams(params json.RawMessage, dst any) *Error {
	if len(params) == 0 || string(params) == "null" {
		params = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(params))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return &Error{Code: codeInvalidParams, Message: "参数非法: " + err.Error()}
	}
	return nil
}

// appError 应用错误（code 沿用 HTTP 状态码语义）。
func appError(status int, msg string) *Error {
	return &Error{Code: status, Message: msg}
}

// taskError 把任务服务错误映射为 RPC 错误。
func taskError(err error) *Error {
	if err == task.ErrNotFound {
		return appError(http.StatusNotFound, "task not found")
	}
	return appError(http.StatusInternalServerError, err.Error())
}
