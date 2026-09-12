package task

import (
	"fmt"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// CreateRequest 创建任务请求体。
//
// HTTP `POST /api/tasks` 与 RPC `tasks.create` 共用同一 JSON 契约（docs/api/rpc.md），
// 校验与转换集中在此，避免两种传输各写一套而漂移。
type CreateRequest struct {
	Kind           model.TaskKind      `json:"kind"` // simulate（缺省）| optimize
	Name           string              `json:"name"`
	Layers         []model.Layer       `json:"layers"`
	SubstrateIndex float64             `json:"substrate_index,omitempty"`
	Optimize       *model.OptimizeSpec `json:"optimize,omitempty"`
}

// InvalidRequestError 请求校验失败；传输层统一映射为 400，Reason 直接面向用户。
type InvalidRequestError struct {
	Reason string
}

func (e *InvalidRequestError) Error() string { return e.Reason }

// invalidRequest 构造请求校验错误。
func invalidRequest(format string, args ...any) error {
	return &InvalidRequestError{Reason: fmt.Sprintf(format, args...)}
}

// ToInput 校验请求并转换为任务创建载荷（HTTP/RPC 共用）。
//
// 异常:
//   - *InvalidRequestError: kind 非法、simulate 缺 layers、optimize 缺 optimize 参数
func (r CreateRequest) ToInput() (CreateInput, error) {
	kind := r.Kind
	if kind == "" {
		kind = model.TaskKindSimulate
	}
	switch kind {
	case model.TaskKindOptimize:
		if r.Optimize == nil {
			return CreateInput{}, invalidRequest("optimize 任务需提供 optimize 参数")
		}
		return CreateInput{Kind: kind, Name: r.Name, Optimize: r.Optimize}, nil
	case model.TaskKindSimulate:
		if len(r.Layers) == 0 {
			return CreateInput{}, invalidRequest("layers 至少需要一层")
		}
		return CreateInput{
			Kind: kind,
			Name: r.Name,
			Stack: &model.FilmStack{
				Name:           r.Name,
				Layers:         r.Layers,
				SubstrateIndex: r.SubstrateIndex,
			},
		}, nil
	default:
		return CreateInput{}, invalidRequest("kind 必须为 simulate 或 optimize")
	}
}
