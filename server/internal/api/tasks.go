package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/task"
)

// taskListResponse GET /api/tasks 响应（与 RPC `tasks.list` 同一结构）。
type taskListResponse struct {
	Tasks []model.SimulationTask `json:"tasks"`
}

// deleteTaskResponse DELETE /api/tasks/{id} 响应（与 RPC `tasks.delete` 同一结构）。
type deleteTaskResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// createTaskHandler POST /api/tasks —— 创建仿真/反推任务（异步执行，返回 202）。
//
// 请求体与校验复用 task.CreateRequest（HTTP/RPC 共用的单一契约来源）。
func createTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var req task.CreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		in, err := req.ToInput()
		if err != nil {
			var bad *task.InvalidRequestError
			if errors.As(err, &bad) {
				writeError(w, http.StatusBadRequest, bad.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
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
//
// 不存在或非本人：统一 404（不泄露存在性）。
func getTaskHandler(tasks *task.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		t, err := tasks.GetOwned(r.Context(), u.ID, r.PathValue("id"))
		switch {
		case errors.Is(err, task.ErrNotFound):
			writeError(w, http.StatusNotFound, "task not found")
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, t)
	}
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
		if err := tasks.DeleteOwned(r.Context(), u.ID, id); err != nil {
			if errors.Is(err, task.ErrNotFound) {
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
