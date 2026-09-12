package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/task"
)

// createTaskRequest POST /api/tasks 请求体（kind=simulate 用 layers/substrate_index；
// kind=optimize 用 optimize 参数）。
type createTaskRequest struct {
	Kind           model.TaskKind      `json:"kind"` // simulate（默认）| optimize
	Name           string              `json:"name"`
	Layers         []model.Layer       `json:"layers"`
	SubstrateIndex float64             `json:"substrate_index,omitempty"`
	Optimize       *model.OptimizeSpec `json:"optimize,omitempty"`
}

type taskListResponse struct {
	Tasks []model.SimulationTask `json:"tasks"`
}

// createTaskHandler POST /api/tasks —— 创建仿真/反推任务（异步执行，返回 202）。
func createTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var req createTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		kind := req.Kind
		if kind == "" {
			kind = model.TaskKindSimulate
		}

		var in task.CreateInput
		switch kind {
		case model.TaskKindOptimize:
			if req.Optimize == nil {
				writeError(w, http.StatusBadRequest, "optimize 任务需提供 optimize 参数")
				return
			}
			in = task.CreateInput{
				Kind:     model.TaskKindOptimize,
				Name:     req.Name,
				Optimize: req.Optimize,
			}
		case model.TaskKindSimulate:
			if len(req.Layers) == 0 {
				writeError(w, http.StatusBadRequest, "layers 至少需要一层")
				return
			}
			in = task.CreateInput{
				Kind: model.TaskKindSimulate,
				Name: req.Name,
				Stack: &model.FilmStack{
					Name:           req.Name,
					Layers:         req.Layers,
					SubstrateIndex: req.SubstrateIndex,
				},
			}
		default:
			writeError(w, http.StatusBadRequest,
				"kind 必须为 simulate 或 optimize")
			return
		}

		created, err := tasks.Create(r.Context(), u.ID, in)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, created)
	}
}

// errTaskNotFound 任务不存在或不属于当前用户（对外统一 404，不泄露存在性）。
var errTaskNotFound = errors.New("task not found")

// fetchOwnedTask 取任务并校验归属。
//
// 返回:
//   - (task, nil)：存在且属于 userID
//   - (nil, errTaskNotFound)：不存在或非本人（调用方回 404）
//   - (nil, err)：存储层错误（调用方回 500）
func fetchOwnedTask(
	ctx context.Context, tasks *task.Service, userID, id string,
) (*model.SimulationTask, error) {
	t, err := tasks.Get(ctx, id)
	if errors.Is(err, task.ErrNotFound) {
		return nil, errTaskNotFound
	}
	if err != nil {
		return nil, err
	}
	if t.UserID != userID {
		return nil, errTaskNotFound
	}
	return t, nil
}

// getTaskHandler GET /api/tasks/{id} —— 查询任务状态与结果（仅本人可见）。
func getTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		t, err := fetchOwnedTask(r.Context(), tasks, u.ID, r.PathValue("id"))
		switch {
		case errors.Is(err, errTaskNotFound):
			writeError(w, http.StatusNotFound, "task not found")
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, t)
	}
}

// deleteTaskResponse DELETE /api/tasks/{id} 响应。
type deleteTaskResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// deleteTaskHandler DELETE /api/tasks/{id} —— 删除任务（含结果，仅本人）。
//
// 任务不存在或非本人：统一 404（与 GET 同语义，不泄露存在性）。
func deleteTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		id := r.PathValue("id")
		if _, err := fetchOwnedTask(r.Context(), tasks, u.ID, id); err != nil {
			if errors.Is(err, errTaskNotFound) {
				writeError(w, http.StatusNotFound, "task not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := tasks.Delete(r.Context(), id); err != nil {
			if errors.Is(err, task.ErrNotFound) {
				// 竞态：校验通过后被并发删除
				writeError(w, http.StatusNotFound, "task not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, deleteTaskResponse{ID: id, Deleted: true})
	}
}

// listTasksHandler GET /api/tasks —— 列出当前用户的任务（新建在前）。
func listTasksHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		list, err := tasks.List(r.Context(), u.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, taskListResponse{Tasks: list})
	}
}
