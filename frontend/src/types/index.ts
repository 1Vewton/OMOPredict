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

export type TaskKind = 'simulate' | 'optimize'

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

// ---------------------------------------------------------------- 目标反推（kind=optimize）

export interface OptimizeTarget {
  /** 可见光平均透过率下限（0–1，百分比输入请除以 100） */
  min_visible_transmittance?: number
  /** 方阻上限 Ω/sq */
  max_sheet_resistance?: number
  /** SE 下限 dB */
  min_se_db?: number
  /** SE 评估频带 [lo, hi] GHz（默认 X 波段 8.2–12.4） */
  se_freq_range_ghz?: [number, number]
}

export interface OptimizeSpace {
  outer_bounds_nm?: [number, number]
  outer_step_nm?: number
  metal_bounds_nm?: [number, number]
  metal_step_nm?: number
  outer_material?: string
  metal_material?: string
  substrate_index?: number
  top_n?: number
}

export interface OptimizeSpec {
  target?: OptimizeTarget
  space?: OptimizeSpace
  compute_sensitivity?: boolean
}

export interface OptimizeCandidate {
  thicknesses_nm: [number, number, number]
  visible_transmittance: number
  /** Ω/sq；无导电层时为 null */
  sheet_resistance: number | null
  /** dB；未求值或无导电层时为 null */
  se_min_db: number | null
  se_band_ghz?: [number, number] | null
  /** Haacke FoM = T_vis¹⁰/Rs */
  fom: number | null
}

export interface OptimizeSensitivityLayer {
  layer_index: number
  material: string
  thickness_nm: number
  /** 每 nm 的 ΔFoM/FoM（相对） */
  dfom_rel_per_nm: number
  /** 每 nm 的 ΔT_vis（绝对） */
  dt_abs_per_nm: number
  /** 每 nm 的 Δlog₁₀Rs；无 Rs 时为 null */
  dlog10_rs_per_nm: number | null
  /** 保持目标可行的工艺窗口 ±nm；无约束/不可行时为 null */
  tolerance_nm: number | null
}

export interface OptimizeReport {
  task_id?: string
  pipeline_version?: string
  n_scanned: number
  n_feasible: number
  elapsed_seconds?: number
  candidates: OptimizeCandidate[]
  best_effort?: OptimizeCandidate | null
  sensitivity?: {
    layers: OptimizeSensitivityLayer[]
  } | null
}

export interface SimulationTask {
  id: string
  user_id: string
  /** simulate（默认）/ optimize；后端总会回填 */
  kind?: TaskKind
  name?: string
  stack?: FilmStack | null
  optimize?: OptimizeSpec
  status: TaskStatus
  /** unix 秒 */
  created_at: number
  updated_at: number
  error?: string
  /** kind=simulate 的结果 */
  result?: TaskResult | null
  /** kind=optimize 的结果（引擎反推报告 JSON） */
  optimize_result?: OptimizeReport | null
}

export interface CreateTaskRequest {
  /** simulate（默认）/ optimize */
  kind?: TaskKind
  name?: string
  /** kind=simulate：膜层 */
  layers?: Layer[]
  substrate_index?: number
  /** kind=optimize：目标与扫描空间 */
  optimize?: OptimizeSpec
}

export interface TaskListResponse {
  tasks: SimulationTask[]
}
