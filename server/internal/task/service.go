// Package task 提供任务编排（M3 simulate + M5 optimize）：
// 任务生命周期管理 + 调用 Python 引擎（omo.api /simulate、/optimize）。
//
// 契约见 docs/api/engine.md。
package task

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// Service 任务编排服务：创建任务并异步执行（立即返回，状态轮询查询）。
type Service struct {
	store  Store
	engine *EngineClient
}

// NewService 构造任务服务。
func NewService(store Store, engine *EngineClient) *Service {
	return &Service{store: store, engine: engine}
}

// CreateInput 创建任务的载荷（按 Kind 二选一填写）。
type CreateInput struct {
	Kind     model.TaskKind
	Name     string
	Stack    *model.FilmStack    // Kind=simulate（正向仿真膜结构）
	Optimize *model.OptimizeSpec // Kind=optimize（目标反推参数）
}

// Create 创建任务（pending）并异步执行；任务 ID 随即返回。
func (s *Service) Create(ctx context.Context, userID string, in CreateInput) (*model.SimulationTask, error) {
	kind := in.Kind
	if kind == "" {
		kind = model.TaskKindSimulate
	}
	t := &model.SimulationTask{
		ID:        newTaskID(),
		UserID:    userID,
		Kind:      kind,
		Name:      in.Name,
		Stack:     in.Stack,
		Optimize:  in.Optimize,
		Status:    model.TaskPending,
		CreatedAt: time.Now().UTC().Unix(),
		UpdatedAt: time.Now().UTC().Unix(),
	}
	if err := s.store.Create(ctx, t); err != nil {
		return nil, err
	}
	go s.run(t.ID)
	return t, nil
}

// Get 查询任务（含状态与结果）。
func (s *Service) Get(ctx context.Context, id string) (*model.SimulationTask, error) {
	return s.store.Get(ctx, id)
}

// List 列出某用户的任务。
func (s *Service) List(ctx context.Context, userID string) ([]model.SimulationTask, error) {
	return s.store.List(ctx, userID)
}

// run 异步执行：running → 调引擎 → succeeded(failed)。
func (s *Service) run(taskID string) {
	ctx := context.Background()
	if err := s.store.UpdateStatus(ctx, taskID, model.TaskRunning, ""); err != nil {
		log.Printf("task %s: mark running: %v", taskID, err)
		return
	}
	t, err := s.store.Get(ctx, taskID)
	if err != nil {
		log.Printf("task %s: get: %v", taskID, err)
		return
	}

	switch t.Kind {
	case model.TaskKindOptimize:
		s.runOptimize(ctx, t)
	default:
		s.runSimulate(ctx, t)
	}
}

// runSimulate 正向仿真：调引擎 /simulate → 结果持久化。
func (s *Service) runSimulate(ctx context.Context, t *model.SimulationTask) {
	if t.Stack == nil {
		s.fail(ctx, t.ID, "simulate 任务缺少 stack")
		return
	}
	result, err := s.engine.Simulate(ctx, *t.Stack)
	if err != nil {
		s.fail(ctx, t.ID, err.Error())
		return
	}
	result.TaskID = t.ID
	if err := s.store.UpdateResult(ctx, t.ID, result); err != nil {
		log.Printf("task %s: save result: %v", t.ID, err)
	}
}

// runOptimize 目标反推：调引擎 /optimize → 报告原样持久化（顶层注入 task_id）。
func (s *Service) runOptimize(ctx context.Context, t *model.SimulationTask) {
	if t.Optimize == nil {
		s.fail(ctx, t.ID, "optimize 任务缺少 optimize 参数")
		return
	}
	raw, err := s.engine.Optimize(ctx, t.Optimize)
	if err != nil {
		s.fail(ctx, t.ID, err.Error())
		return
	}
	injected, err := withTaskID(raw, t.ID)
	if err != nil {
		s.fail(ctx, t.ID, err.Error())
		return
	}
	if err := s.store.UpdateOptimizeResult(ctx, t.ID, injected); err != nil {
		log.Printf("task %s: save optimize result: %v", t.ID, err)
	}
}

// fail 置为 failed 并记录错误消息。
func (s *Service) fail(ctx context.Context, id, msg string) {
	if err := s.store.UpdateStatus(ctx, id, model.TaskFailed, msg); err != nil {
		log.Printf("task %s: mark failed: %v", id, err)
	}
}

// newTaskID 生成随机任务 ID（32 位十六进制）。
func newTaskID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("task-%d", time.Now().UnixNano()) // 极不可能，兜底
	}
	return hex.EncodeToString(buf)
}
