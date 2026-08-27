# 文献对标数据集（docs/benchmarks/）

每个 JSON 文件对应一篇（或多篇同体系）论文的实测数据。命名：`体系_作者年份.json`。

## Schema 总览

```json
{
  "meta": {
    "id": "唯一标识（文件名风格）",
    "paper": { "title": "...", "authors": "...", "year": 2020, "doi": "10.xxxx/yyyy", "journal": "..." },
    "substrate": { "material": "glass", "index": 1.5 },
    "extraction": { "method": "table | figure-digitized", "note": "提取条件" }
  },
  "records": [
    {
      "id": "s1",
      "stack": [{ "material": "ITO", "thickness_nm": 40.0 }, { "material": "Ag", "thickness_nm": 10.0 }],
      "measured": {
        "transmittance": [{ "wavelength_nm": 550.0, "value": 0.87 }],
        "reflectance":  [{ "wavelength_nm": 550.0, "value": 0.05 }],
        "sheet_resistance": 6.5,
        "se": [{ "frequency_ghz": 10.0, "value": 28.0 }],
        "se_x_band": 28.0
      }
    }
  ],
  "simulation": {
    "materials": {
      "ITO": { "optics": { "constant_index": [1.82, 0.0] }, "electrical": { "bulk_resistivity": 1.2e-6 } },
      "Ag":  { "optics": { "drude": { "eps_inf": 3.7, "plasma_energy_ev": 9.1, "damping_energy_ev": 0.03 } },
               "electrical": { "mean_free_path_nm": 55.0 } }
    }
  }
}
```

## 约定

- `measured` 为任意子集（可缺项）：只有 Rs 的记录不会触发光学/屏蔽仿真
- 透过率/反射率为**小数**（0–1）；Rs 单位 Ω/sq；SE 单位 dB
- `simulation.materials` 可选：覆盖引擎默认材料常数（**M2.3 校准产物**）；
  光学覆盖二选一：`constant_index`（[n, k] 数组）或 `drude`（完整参数）
- 材料名对应 `omo.benchmark.materials.MaterialResolver` 注册表（ITO / Ag / glass），
  新材料须在注册表或覆盖段中提供

## 当前文件

| 文件 | 来源 | 状态 |
|---|---|---|
| `synthetic_ito_ag_ito.json` | 合成（引擎生成） | 框架验证用 |
| 真实文献数据集（≥3 篇） | 待提取（M2.2） | 进行中 |
