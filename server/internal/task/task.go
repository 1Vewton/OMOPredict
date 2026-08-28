// Package task 提供仿真任务编排（M3，实现中）：
// 任务生命周期管理 + 调用 Python 引擎（omo.api）。
package task

import (
	"context"

	"github.com/1Vewton/OMOPredict/server/internal/model"
)

// Store 任务存储接口（后续以 SQLite / 内存实现）。
type Store interface {
	Create(ctx context.Context, t *model.SimulationTask) error
	Get(ctx context.Context, id string) (*model.SimulationTask, error)
	List(ctx context.Context, userID string) ([]model.SimulationTask, error)
	UpdateStatus(ctx context.Context, id string, status model.TaskStatus, errMsg string) error
}
