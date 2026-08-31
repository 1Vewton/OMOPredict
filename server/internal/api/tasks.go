package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/task"
)

// createTaskRequest POST /api/tasks 请求体。
type createTaskRequest struct {
	Name           string        `json:"name"`
	Layers         []model.Layer `json:"layers"`
	SubstrateIndex float64       `json:"substrate_index,omitempty"`
}

type taskListResponse struct {
	Tasks []model.SimulationTask `json:"tasks"`
}

// createTaskHandler POST /api/tasks —— 创建仿真任务（异步执行，返回 202）。
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
		if len(req.Layers) == 0 {
			writeError(w, http.StatusBadRequest, "layers 至少需要一层")
			return
		}
		created, err := tasks.Create(r.Context(), u.ID, model.FilmStack{
			Name:           req.Name,
			Layers:         req.Layers,
			SubstrateIndex: req.SubstrateIndex,
		})
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
