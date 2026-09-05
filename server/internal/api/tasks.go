package api

import (
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

// getTaskHandler GET /api/tasks/{id} —— 查询任务状态与结果（仅本人可见）。
func getTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		t, err := tasks.Get(r.Context(), r.PathValue("id"))
		if errors.Is(err, task.ErrNotFound) || (err == nil && t.UserID != u.ID) {
			// 不存在或非本人：统一 404（不泄露任务存在性）
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, t)
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
