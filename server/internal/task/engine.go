// Package task 提供仿真任务编排（M3）：
// 任务生命周期管理 + 调用 Python 引擎（omo.api /simulate）。
//
// 契约见 docs/api/engine.md。
package task

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// EngineClient 调用 Python 仿真引擎的 HTTP 客户端。
type EngineClient struct {
	baseURL string
	client  *http.Client
}

// NewEngineClient 构造引擎客户端。
// baseURL 为引擎根地址（如 http://127.0.0.1:8000），尾部斜杠会被去掉。
func NewEngineClient(baseURL string) *EngineClient {
	url := baseURL
	for len(url) > 0 && url[len(url)-1] == '/' {
		url = url[:len(url)-1]
	}
	return &EngineClient{
		baseURL: url,
		client:  &http.Client{Timeout: 60 * time.Second},
	}
}

// engineRequest /simulate 请求体（对应 omo.api.schemas.SimulateRequest）。
type engineRequest struct {
	Layers         []model.Layer `json:"layers"`
	SubstrateIndex float64       `json:"substrate_index"`
}

// engineResponse /simulate 响应体（对应 SimulateResponse）。
type engineResponse struct {
	Transmittance   []model.SpectrumPoint `json:"transmittance"`
	Reflectance     []model.SpectrumPoint `json:"reflectance"`
	SheetResistance *float64              `json:"sheet_resistance"`
	SEDB            []model.SpectrumPoint `json:"se_db"`
}

// Simulate 提交膜结构并同步返回仿真结果。
//
// 异常:
//   - 引擎返回非 200（含 422 校验错误，detail 透传）
//   - 网络/超时错误
func (c *EngineClient) Simulate(ctx context.Context, stack model.FilmStack) (*model.TaskResult, error) {
	substrate := stack.SubstrateIndex
	if substrate == 0 {
		substrate = 1.5 // 与引擎默认一致
	}
	payload, err := json.Marshal(engineRequest{
		Layers:         stack.Layers,
		SubstrateIndex: substrate,
	})
	if err != nil {
		return nil, fmt.Errorf("task: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/simulate", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("task: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("task: engine request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var e struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Detail == "" {
			e.Detail = string(body)
		}
		return nil, fmt.Errorf("engine /simulate: %s: %s", resp.Status, e.Detail)
	}

	var out engineResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("task: decode response: %w", err)
	}
	return &model.TaskResult{
		Transmittance:   out.Transmittance,
		Reflectance:     out.Reflectance,
		SheetResistance: out.SheetResistance,
		SEDB:            out.SEDB,
	}, nil
}

// Optimize 提交目标反推请求并同步返回引擎报告（JSON 原样，不解析内容）。
//
// spec 的 JSON 键与引擎 /optimize 请求对齐（target/space/compute_sensitivity）。
//
// 异常:
//   - 引擎返回非 200（含 422 校验错误，detail 透传）
//   - 网络/超时错误
//   - 引擎响应不是合法 JSON
func (c *EngineClient) Optimize(ctx context.Context, spec *model.OptimizeSpec) (json.RawMessage, error) {
	payload, err := json.Marshal(spec)
	if err != nil {
		return nil, fmt.Errorf("task: marshal optimize request: %w", err)
	}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+"/optimize", bytes.NewReader(payload),
	)
	if err != nil {
		return nil, fmt.Errorf("task: build optimize request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("task: engine optimize request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var e struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Detail == "" {
			e.Detail = string(body)
		}
		return nil, fmt.Errorf("engine /optimize: %s: %s", resp.Status, e.Detail)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20)) // 16 MiB 上限
	if err != nil {
		return nil, fmt.Errorf("task: read optimize response: %w", err)
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("task: engine /optimize 返回非法 JSON")
	}
	return json.RawMessage(raw), nil
}

// withTaskID 在引擎报告 JSON 顶层注入 task_id（与 simulate 的 TaskResult.TaskID 语义一致）。
func withTaskID(raw json.RawMessage, taskID string) (json.RawMessage, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("task: decode optimize result: %w", err)
	}
	m["task_id"] = taskID
	out, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("task: re-encode optimize result: %w", err)
	}
	return json.RawMessage(out), nil
}
