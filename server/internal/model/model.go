// Package model 定义中间层核心数据模型（膜结构、仿真任务、结果）。
//
// 字段命名 snake_case，与 Python 引擎 JSON 契约一致（AGENTS.md §6.7）。
package model

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

// SimulationTask 仿真任务（GORM 模型；Stack/Result 以 JSON 序列化存储）。
type SimulationTask struct {
	ID        string      `gorm:"primaryKey" json:"id"`
	UserID    string      `gorm:"index" json:"user_id"`
	Stack     FilmStack   `gorm:"serializer:json" json:"stack"`
	Status    TaskStatus  `json:"status"`
	CreatedAt int64       `json:"created_at"` // unix 秒
	UpdatedAt int64       `json:"updated_at"`
	Error     string      `json:"error,omitempty"`
	Result    *TaskResult `gorm:"serializer:json" json:"result,omitempty"`
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
