// Package model 定义中间层核心数据模型（膜结构、仿真任务、结果）。
//
// 字段命名 snake_case，与 Python 引擎 JSON 契约一致（AGENTS.md §6.7）。
package model

import "encoding/json"

// Layer 描述膜层（对应 Python 引擎 optics.Layer 的输入）。
type Layer struct {
	Material  string  `json:"material"`     // 材料名（ITO / Ag / ...）
	Thickness float64 `json:"thickness_nm"` // 厚度（nm）
}

// FilmStack 描述多层膜结构。
type FilmStack struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Layers []Layer `json:"layers"`
	// SubstrateIndex 衬底折射率（默认 1.5，0 表示未指定）。
	SubstrateIndex float64 `json:"substrate_index,omitempty"`
}

// TaskStatus 仿真任务状态机。
type TaskStatus string

const (
	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskSucceeded TaskStatus = "succeeded"
	TaskFailed    TaskStatus = "failed"
)

// TaskKind 仿真任务类型。
type TaskKind string

const (
	TaskKindSimulate TaskKind = "simulate" // 正向仿真（默认，M3 起）
	TaskKindOptimize TaskKind = "optimize" // 目标反推（M5 v1：约束 → 候选膜厚组合）
)

// OptimizeTarget 目标反推的目标约束（硬约束，与引擎契约一致；nil = 不限）。
type OptimizeTarget struct {
	MinVisibleTransmittance *float64  `json:"min_visible_transmittance,omitempty"` // 0–1
	MaxSheetResistance      *float64  `json:"max_sheet_resistance,omitempty"`      // Ω/sq
	MinSEDB                 *float64  `json:"min_se_db,omitempty"`                 // dB
	SEFreqRangeGHz          []float64 `json:"se_freq_range_ghz,omitempty"`         // [lo, hi]
}

// OptimizeSpace 目标反推的扫描空间（nil = 引擎默认：外层 20–80 步长 4、金属 5–20 步长 1）。
type OptimizeSpace struct {
	OuterBoundsNm  []float64 `json:"outer_bounds_nm,omitempty"`
	OuterStepNm    *float64  `json:"outer_step_nm,omitempty"`
	MetalBoundsNm  []float64 `json:"metal_bounds_nm,omitempty"`
	MetalStepNm    *float64  `json:"metal_step_nm,omitempty"`
	OuterMaterial  string    `json:"outer_material,omitempty"`
	MetalMaterial  string    `json:"metal_material,omitempty"`
	SubstrateIndex *float64  `json:"substrate_index,omitempty"`
	TopN           *int      `json:"top_n,omitempty"`
}

// OptimizeSpec 目标反推任务参数（JSON 键与引擎 /optimize 请求对齐）。
type OptimizeSpec struct {
	Target             *OptimizeTarget `json:"target,omitempty"`
	Space              *OptimizeSpace  `json:"space,omitempty"`
	ComputeSensitivity *bool           `json:"compute_sensitivity,omitempty"`
}

// SimulationTask 仿真/反推任务（GORM 模型；结构化字段以 JSON 序列化存储）。
// kind=simulate 用 Stack + Result；kind=optimize 用 Optimize + OptimizeResult。
type SimulationTask struct {
	ID        string        `gorm:"primaryKey" json:"id"`
	UserID    string        `gorm:"index" json:"user_id"`
	Kind      TaskKind      `gorm:"index;default:simulate" json:"kind"`
	Name      string        `json:"name,omitempty"` // 任务名（可选，列表展示用）
	Stack     *FilmStack    `gorm:"serializer:json" json:"stack,omitempty"`
	Optimize  *OptimizeSpec `gorm:"serializer:json" json:"optimize,omitempty"`
	Status    TaskStatus    `json:"status"`
	CreatedAt int64         `json:"created_at"` // unix 秒
	UpdatedAt int64         `json:"updated_at"`
	Error     string        `json:"error,omitempty"`
	// Result 正向仿真结果（kind=simulate）。
	Result *TaskResult `gorm:"serializer:json" json:"result,omitempty"`
	// OptimizeResult 目标反推结果（kind=optimize）：引擎 /optimize 报告 JSON 原样存储。
	OptimizeResult json.RawMessage `gorm:"serializer:json" json:"optimize_result,omitempty"`
}

// TaskResult 仿真结果（对齐 Python 引擎输出）。
type TaskResult struct {
	TaskID          string          `json:"task_id"`
	Transmittance   []SpectrumPoint `json:"transmittance,omitempty"`
	Reflectance     []SpectrumPoint `json:"reflectance,omitempty"`
	SheetResistance *float64        `json:"sheet_resistance,omitempty"` // Ω/sq
	SEDB            []SpectrumPoint `json:"se_db,omitempty"`            // dB
}

// SpectrumPoint 光谱点（x 为波长 nm 或频率 GHz，由所属字段决定）。
type SpectrumPoint struct {
	X     float64 `json:"x"`
	Value float64 `json:"value"`
}
