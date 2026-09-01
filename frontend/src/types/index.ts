// 与 Go 中间层 REST API（docs/api/rest.md）对应的数据模型。
// 字段命名 snake_case，与后端 JSON 契约一致（AGENTS.md §6.7）。

export interface User {
  id: string
  username: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface Layer {
  /** 材料名（ITO / Ag / glass，见引擎材料注册表 omo.materials） */
  material: string
  /** 层厚（nm） */
  thickness_nm: number
}

export interface FilmStack {
  id?: string
  name?: string
  layers: Layer[]
  /** 衬底折射率（默认 1.5） */
  substrate_index?: number
}

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface SpectrumPoint {
  /** 波长 nm（光学）或频率 GHz（屏蔽），由所属字段决定 */
  x: number
  value: number
}

export interface TaskResult {
  task_id?: string
  transmittance: SpectrumPoint[]
  reflectance: SpectrumPoint[]
  /** Ω/sq；无导电层时为 null */
  sheet_resistance?: number | null
  /** dB；无导电层时为空数组 */
  se_db: SpectrumPoint[]
}

export interface SimulationTask {
  id: string
  user_id: string
  stack: FilmStack
  status: TaskStatus
  /** unix 秒 */
  created_at: number
  updated_at: number
  error?: string
  result?: TaskResult | null
}

export interface CreateTaskRequest {
  name?: string
  layers: Layer[]
  substrate_index?: number
}

export interface TaskListResponse {
  tasks: SimulationTask[]
}
