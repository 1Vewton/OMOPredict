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
