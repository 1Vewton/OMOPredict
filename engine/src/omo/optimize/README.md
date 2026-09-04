# omo.optimize —— 目标反推与工艺指导（M5 v1）

## 职责

给定**性能目标**（可见光平均透过率 / 方阻 / 屏蔽效能的硬约束），在
OMO 三层厚度空间上**反向扫描寻优**，返回满足约束的膜厚组合（按
Haacke 品质因子 FoM = T_vis¹⁰/Rs 排序），并对最佳候选输出**逐层灵敏度**
（每 nm 厚度变化的影响）与**工艺窗口**（保持目标可行的单层厚度容差）。

分层纪律：反推属于物理逻辑，只在本 Python 包内实现；求值路径与正向
仿真（omo.api / omo.neural）同源，反推结果以物理引擎为唯一基准。

## 核心模块

| 模块 | 职责 |
|---|---|
| `target.py` | `DesignTarget`：硬约束（min T_vis / max Rs / min SE）+ SE 频带 |
| `evaluate.py` | `evaluate_candidate`：膜厚组合 → T_vis / Rs / SE_min / FoM |
| `search.py` | `OmoSearchConfig` + `search_designs`：网格扫描 → `OptimizeReport` |
| `sensitivity.py` | `analyze_sensitivity`：逐层灵敏度 + 工艺窗口 |

## 如何调用（最小示例）

```python
from omo.optimize import DesignTarget, OmoSearchConfig, search_designs, analyze_sensitivity

# 1. 设目标：可见光平均透过率 ≥ 85% 且方阻 ≤ 12 Ω/sq，X 波段 SE ≥ 25 dB
target = DesignTarget(
    min_visible_transmittance=0.85,
    max_sheet_resistance=12.0,
    min_se_db=25.0,          # 频带默认 X 波段 8.2–12.4 GHz
)

# 2. 扫描（默认 ITO/Ag/ITO：外层 20–80 步长 4、金属 5–20 步长 1 ≈ 4k 组合）
report = search_designs(target)   # 或 OmoSearchConfig(outer_bounds_nm=(30, 60), ...)

print(f"扫描 {report.n_scanned} 组合 · 可行 {report.n_feasible} 组 · 用时 {report.elapsed_seconds:.1f}s")
for m in report.candidates:       # 可行解按 FoM 降序
    print(m.thicknesses_nm, f"T={m.visible_transmittance:.3f}",
          f"Rs={m.sheet_resistance:.2f} Ω/sq", f"SE={m.se_min_db:.1f} dB", f"FoM={m.fom:.4f}")

# 3. 最佳候选的灵敏度与工艺窗口
if report.candidates:
    sens = analyze_sensitivity(report.candidates[0], report.config.materials, target)
    for s in sens.layers:
        print(f"层{s.layer_index}({s.material}) {s.thickness_nm:g}nm: "
              f"ΔFoM/FoM = {s.dfom_rel_per_nm:+.4f}/nm, "
              f"ΔT = {s.dt_abs_per_nm:+.5f}/nm, "
              f"工艺窗口 ±{s.tolerance_nm:g} nm")

# 4. 报告序列化（JSON）
report.to_dict()
```

## 命令行

```bash
uv run omo-cli optimize \
  --min-t 0.85 --max-rs 12 --min-se 25 \
  --outer-min 20 --outer-max 80 --metal-min 5 --metal-max 20 \
  --json optimize_report.json
```

## 设计说明

- **确定性**：纯网格扫描，无随机性；`OptimizeReport.pipeline_version` 随附可追溯。
- **速度**：默认 ~4k 组合进程内数秒；无 SE 约束时自动跳过屏蔽求值。
- **自洽验收**：候选由物理引擎求值产生；测试将 Top 候选回灌引擎复核，
  误差为 0（不依赖 NN 代理）。M2.5 NN 代理可作后续加速后端，接口不变。
- **外推域**：默认扫描空间与 NN 代理训练域一致（外层 20–80、金属 5–20 nm），
  超出需自行权衡（渗流效应等模型边界见 HANDOVER §6.9）。
