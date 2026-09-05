// Package task 提供仿真任务编排（M3）：
// 任务生命周期管理 + 调用 Python 引擎（omo.api /simulate）。
//
// 契约见 docs/api/engine.md。
package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"gorm.io/gorm"
)

// ErrNotFound 任务不存在。
var ErrNotFound = errors.New("task: not found")

// Store 任务存储接口。
type Store interface {
	Create(ctx context.Context, t *model.SimulationTask) error
	Get(ctx context.Context, id string) (*model.SimulationTask, error)
	List(ctx context.Context, userID string) ([]model.SimulationTask, error)
	UpdateStatus(ctx context.Context, id string, status model.TaskStatus, errMsg string) error
	UpdateResult(ctx context.Context, id string, result *model.TaskResult) error
	// UpdateOptimizeResult 写入目标反推结果（引擎报告 JSON 原样）并置为 succeeded。
	UpdateOptimizeResult(ctx context.Context, id string, raw json.RawMessage) error
}

// GORMStore 基于 GORM 的任务存储（兼容 sqlite / mysql / postgres）。
type GORMStore struct {
	db *gorm.DB
}

// NewGORMStore 构造 GORM 任务存储。
func NewGORMStore(db *gorm.DB) *GORMStore {
	return &GORMStore{db: db}
}

// Create 插入任务。
func (s *GORMStore) Create(ctx context.Context, t *model.SimulationTask) error {
	if err := s.db.WithContext(ctx).Create(t).Error; err != nil {
		return fmt.Errorf("task: create: %w", err)
	}
	return nil
}

// Get 按 ID 查询；不存在返回 ErrNotFound。
func (s *GORMStore) Get(ctx context.Context, id string) (*model.SimulationTask, error) {
	var t model.SimulationTask
	err := s.db.WithContext(ctx).First(&t, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("task: get: %w", err)
	}
	return &t, nil
}

// List 列出某用户的任务（新建在前）。
func (s *GORMStore) List(ctx context.Context, userID string) ([]model.SimulationTask, error) {
	var tasks []model.SimulationTask
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&tasks).Error
	if err != nil {
		return nil, fmt.Errorf("task: list: %w", err)
	}
	return tasks, nil
}

// UpdateStatus 更新状态与错误消息（同时刷新 updated_at）。
func (s *GORMStore) UpdateStatus(ctx context.Context, id string, status model.TaskStatus, errMsg string) error {
	return s.db.WithContext(ctx).Model(&model.SimulationTask{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"status":     status,
			"error":      errMsg,
			"updated_at": nowUnix(),
		}).Error
}

// UpdateResult 写入结果并置为 succeeded。
func (s *GORMStore) UpdateResult(ctx context.Context, id string, result *model.TaskResult) error {
	// 先取回任务再 Save，保证 serializer:json 字段正确序列化
	t, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	t.Result = result
	t.Status = model.TaskSucceeded
	t.UpdatedAt = nowUnix()
	return s.db.WithContext(ctx).Save(t).Error
}

// UpdateOptimizeResult 写入目标反推结果（JSON 原样）并置为 succeeded。
func (s *GORMStore) UpdateOptimizeResult(ctx context.Context, id string, raw json.RawMessage) error {
	t, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	t.OptimizeResult = raw
	t.Status = model.TaskSucceeded
	t.UpdatedAt = nowUnix()
	return s.db.WithContext(ctx).Save(t).Error
}

func nowUnix() int64 {
	return time.Now().UTC().Unix()
}
