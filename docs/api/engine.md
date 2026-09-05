# 引擎契约（Go → Python `omo.api /simulate`）

Go 中间层通过 HTTP 调用 Python 仿真引擎（FastAPI），执行膜结构仿真。
引擎实现见 `engine/src/omo/api/`（服务：`uv run uvicorn omo.api.main:app --port 8000`）。

## `POST {engine_url}/simulate`

### 请求

```json
{
  "layers": [
    {"material": "ITO", "thickness_nm": 40.0},
    {"material": "Ag",  "thickness_nm": 10.0},
    {"material": "ITO", "thickness_nm": 40.0}
  ],
  "substrate_index": 1.5,
  "wavelengths_nm": [550.0],
  "freqs_ghz": [10.0]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `layers` | ✅ | 膜层（入射侧 → 出射侧），至少 1 层；`material` 见材料注册表，`thickness_nm ≥ 0` |
| `substrate_index` | 否 | 衬底折射率，默认 1.5 |
| `wavelengths_nm` | 否 | 光学输出网格；缺省 380–1000 nm 步长 10（63 点） |
| `freqs_ghz` | 否 | 屏蔽输出网格；缺省 1–18 GHz 步长 1（18 点） |

### 响应

```json
200 {
  "transmittance": [{"x": 550.0, "value": 0.9745}],
  "reflectance":   [{"x": 550.0, "value": 0.0162}],
  "sheet_resistance": 3.9708,
  "se_db":         [{"x": 10.0, "value": 33.70}]
}
```

| 字段 | 说明 |
|---|---|
| `transmittance` / `reflectance` | 光谱点（x = 波长 nm，value = 0–1） |
| `sheet_resistance` | 方阻 Ω/sq（含 Fuchs–Sondheimer 尺寸效应）；无导电层时为 `null` |
| `se_db` | 屏蔽效能点（x = 频率 GHz，value = dB）；无导电层时为空数组 |

### 错误

| 状态码 | 含义 |
|---|---|
| `422` | 未知材料、空膜层、负厚度、网格非正（detail 为错误消息） |

## `POST {engine_url}/optimize` —— 目标反推（M5 v1，供 Go 任务 kind=optimize 调用）

给定**目标约束**，在 OMO 三层厚度空间上网格扫描反推膜厚组合（物理引擎求值，
同步返回，默认规模 ~4k 组合约 3 s）。实现见 `omo.optimize`（target/evaluate/search/sensitivity）。

### 请求（所有字段可选，None = 引擎默认）

```json
{
  "target": {
    "min_visible_transmittance": 0.85,
    "max_sheet_resistance": 12.0,
    "min_se_db": 25.0,
    "se_freq_range_ghz": [8.2, 12.4]
  },
  "space": {
    "outer_bounds_nm": [20.0, 80.0],
    "outer_step_nm": 4.0,
    "metal_bounds_nm": [5.0, 20.0],
    "metal_step_nm": 1.0,
    "outer_material": "ITO",
    "metal_material": "Ag",
    "substrate_index": 1.5,
    "top_n": 10
  },
  "compute_sensitivity": true
}
```

| 字段 | 说明 |
|---|---|
| `target` | 硬约束（AND）：`min_visible_transmittance`（0–1）、`max_sheet_resistance`（Ω/sq）、`min_se_db`（dB，默认 X 波段 8.2–12.4 GHz）；全缺省 = 无约束浏览扫描 |
| `space` | 扫描空间：外层/金属厚度范围与步长（nm）、材料名、衬底折射率、`top_n`；缺省外层 20–80 步长 4、金属 5–20 步长 1（4096 组合，上限 2e6） |
| `compute_sensitivity` | 是否对 Top 可行候选计算逐层灵敏度/工艺窗口（默认 true） |

### 响应 `200`

```json
{
  "pipeline_version": "omo.optimize.search-v1",
  "target": { "...": "回显请求目标" },
  "config": { "...": "实际生效的扫描配置" },
  "n_scanned": 4096,
  "n_feasible": 1565,
  "elapsed_seconds": 3.02,
  "candidates": [
    {
      "thicknesses_nm": [52.0, 8.0, 56.0],
      "visible_transmittance": 0.9643,
      "sheet_resistance": 4.75,
      "se_min_db": 32.19,
      "se_band_ghz": [8.2, 12.4],
      "fom": 0.14656
    }
  ],
  "best_effort": { "...": "全体 FoM 最高（可能不满足约束）" },
  "sensitivity": {
    "nominal": { "...": "Top 候选指标" },
    "layers": [
      {
        "layer_index": 1,
        "material": "Ag",
        "thickness_nm": 8.0,
        "dfom_rel_per_nm": -0.0091,
        "dt_abs_per_nm": -0.01371,
        "dlog10_rs_per_nm": -0.0579,
        "tolerance_nm": 4.5
      }
    ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `candidates` | 满足全部约束的可行候选，按 FoM = T_vis¹⁰/Rs 降序取前 top_n；无可行解时为空数组 |
| `sensitivity` | Top 候选的逐层灵敏度（每 nm：ΔFoM/FoM、ΔT_vis、Δlog₁₀Rs）与工艺窗口 `tolerance_nm`；无可行候选或 `compute_sensitivity=false` 时为 `null` |
| `fom`/`sensitivity` | Haacke FoM，来源 G. Haacke, J. Appl. Phys. 47, 4086 (1976) |

### 错误

| 状态码 | 含义 |
|---|---|
| `422` | 配置非法：范围/步长/材料越界、未知材料、组合数超上限（detail 为错误消息） |

## 材料注册表（`omo.materials`）

| 材料 | 光学模型 | 电学模型 |
|---|---|---|
| `ITO` | 常数折射率 n=1.8（M2.3 校准产物可覆盖） | ρ=1.5e-6 Ω·m |
| `Ag` | Drude（ε∞=3.7, ħωp=9.1eV, ħγ=0.02eV） | ρ=1.59e-8 Ω·m，λ=52nm（尺寸效应） |
| `glass` | 常数折射率 n=1.5 | 绝缘体（不参与方阻/屏蔽） |

新材料通过 `omo.materials` 注册表或请求侧材料覆盖引入。

## 物理模型

- 光学：传输矩阵法 TMM（`omo.optics`，文档 `docs/physics/tmm.md`）
- 电学：并联方阻 + Fuchs–Sondheimer（`omo.electrical`，文档 `docs/physics/electrical.md`）
- 屏蔽：传输线模型（`omo.emi`，文档 `docs/physics/emi.md`）

## 实现位置

- 引擎侧：`engine/src/omo/api/`（`main.py` / `service.py` / `schemas.py`）
- Go 侧调用方：`server/internal/task/`（任务编排，实现中）
