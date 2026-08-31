// Package task 提供仿真任务编排（M3）：
// 任务生命周期管理 + 调用 Python 引擎（omo.api /simulate）。
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

// Create 创建任务（pending）并异步执行；任务 ID 随即返回。
func (s *Service) Create(ctx context.Context, userID string, stack model.FilmStack) (*model.SimulationTask, error) {
	t := &model.SimulationTask{
		ID:        newTaskID(),
		UserID:    userID,
		Stack:     stack,
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
	result, err := s.engine.Simulate(ctx, t.Stack)
	if err != nil {
		if uerr := s.store.UpdateStatus(ctx, taskID, model.TaskFailed, err.Error()); uerr != nil {
			log.Printf("task %s: mark failed: %v", taskID, uerr)
		}
		return
	}
	result.TaskID = taskID
	if err := s.store.UpdateResult(ctx, taskID, result); err != nil {
		log.Printf("task %s: save result: %v", taskID, err)
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
