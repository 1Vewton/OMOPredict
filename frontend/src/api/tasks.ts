import type { CreateTaskRequest, SimulationTask, TaskListResponse } from '@/types'
import { invoke } from './client'

/** 删除任务响应（docs/api/rest.md：`DELETE /api/tasks/{id}`）。 */
export interface DeleteTaskResponse {
  id: string
  deleted: boolean
}

/** 仿真/反推任务接口（docs/api/rest.md §仿真任务）。 */
export const tasksApi = {
  /** 创建任务（异步执行，返回 202 与 pending 任务） */
  create: (data: CreateTaskRequest): Promise<SimulationTask> =>
    invoke<SimulationTask>('tasks.create', { ...data }),

  /** 查询任务状态与结果（仅本人） */
  get: (id: string): Promise<SimulationTask> => invoke<SimulationTask>('tasks.get', { id }),

  /** 列出当前用户任务（新建在前） */
  list: (): Promise<TaskListResponse> => invoke<TaskListResponse>('tasks.list'),

  /** 删除任务（含结果；不存在或非本人统一 404） */
  remove: (id: string): Promise<DeleteTaskResponse> =>
    invoke<DeleteTaskResponse>('tasks.delete', { id }),
}
