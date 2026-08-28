package model

import (
	"encoding/json"
	"testing"
)

func TestTaskResultJSONRoundTrip(t *testing.T) {
	rs := 3.97
	in := TaskResult{
		TaskID:          "task-1",
		Transmittance:   []SpectrumPoint{{X: 550, Value: 0.9745}},
		SheetResistance: &rs,
		SEDB:            []SpectrumPoint{{X: 10.0, Value: 33.7}},
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out TaskResult
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.TaskID != in.TaskID {
		t.Fatalf("task_id = %q, want %q", out.TaskID, in.TaskID)
	}
	if out.SheetResistance == nil || *out.SheetResistance != rs {
		t.Fatalf("sheet_resistance = %v, want %v", out.SheetResistance, rs)
	}
	if len(out.Transmittance) != 1 || out.Transmittance[0].X != 550 {
		t.Fatalf("transmittance 往返异常: %+v", out.Transmittance)
	}
}

func TestLayerSnakeCaseKeys(t *testing.T) {
	layer := Layer{Material: "ITO", Thickness: 40}
	data, err := json.Marshal(layer)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := raw["thickness_nm"]; !ok {
		t.Fatalf("缺少 snake_case 键 thickness_nm: %s", data)
	}
}
