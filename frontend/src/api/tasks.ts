import type { CreateTaskRequest, SimulationTask, TaskListResponse } from '@/types'
import { http } from './http'

/** 仿真任务接口（docs/api/rest.md §仿真任务，均需认证）。 */
export const tasksApi = {
  /** 创建任务（异步执行，返回 202 与 pending 任务） */
  create: (data: CreateTaskRequest): Promise<SimulationTask> =>
    http.post<SimulationTask>('/api/tasks', data),

  /** 查询任务状态与结果（仅本人） */
  get: (id: string): Promise<SimulationTask> => http.get<SimulationTask>(`/api/tasks/${id}`),

  /** 列出当前用户任务（新建在前） */
  list: (): Promise<TaskListResponse> => http.get<TaskListResponse>('/api/tasks'),
}
