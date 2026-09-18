package task

import (
	"context"
	"errors"
	"testing"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/store/storetest"
)

// newTestTaskStore 用内存 SQLite 构造任务存储（见 internal/store/storetest）。
func newTestTaskStore(t *testing.T) *GORMStore {
	t.Helper()
	return NewGORMStore(storetest.OpenMemory(t, &model.SimulationTask{}))
}

// TestGORMStoreDelete 删除语义：成功后不可再查，重复删除返回 ErrNotFound。
func TestGORMStoreDelete(t *testing.T) {
	t.Parallel()
	s := newTestTaskStore(t)
	ctx := context.Background()

	task := &model.SimulationTask{
		ID:        "t-delete-1",
		UserID:    "local",
		Kind:      model.TaskKindSimulate,
		Status:    model.TaskPending,
		CreatedAt: 1,
		UpdatedAt: 1,
	}
	if err := s.Create(ctx, task); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.Delete(ctx, task.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.Get(ctx, task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("删除后 Get 应 ErrNotFound，得到 %v", err)
	}
	if err := s.Delete(ctx, task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("重复删除应 ErrNotFound，得到 %v", err)
	}

	// 仅删除目标任务：其他任务不受影响
	keep := &model.SimulationTask{ID: "t-keep", UserID: "local", CreatedAt: 2, UpdatedAt: 2}
	if err := s.Create(ctx, keep); err != nil {
		t.Fatalf("create keep: %v", err)
	}
	if err := s.Delete(ctx, task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("删除已删任务应 ErrNotFound，得到 %v", err)
	}
	if got, err := s.List(ctx, "local"); err != nil || len(got) != 1 || got[0].ID != "t-keep" {
		t.Fatalf("List = %+v (err=%v)，want 仅保留 t-keep", got, err)
	}
}
