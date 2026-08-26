# 电学模型（omo.electrical）

> 状态：M1 已实现（`engine/src/omo/electrical/sheet_resistance.py`、`materials.py`）。
> 本文档与代码同步维护（AGENTS.md 守则第 10 条）。

## 1. 模型概述

对多层膜（导电层面内并联），计算总方阻 Rs；超薄金属层（d ~ 5–15 nm）
考虑 Fuchs–Sondheimer 表面散射导致的电阻率增强。

## 2. 并联方阻模型

电流在膜平面内流动，各导电层电导并联：

    1/Rs = Σ 1/Rs_i = Σ d_i / ρ_eff,i

其中 Rs_i = ρ_eff,i / d_i 为第 i 层单独存在时的方阻。
绝缘层（ρ 极大，如 SiO₂）贡献可忽略，可省去；弱导电层（如 ITO）自动计入。

单位：厚度 nm，电阻率 Ω·m，方阻 Ω/sq（Rs = ρ/d，d 换算为 m）。

## 3. Fuchs–Sondheimer 尺寸效应

超薄金属膜中表面散射缩短有效平均自由程，等效电阻率增大：

    ρ_film/ρ_bulk = 1 / [1 − (3(1−p)/(2κ))·∫₁^∞ (1/t³ − 1/t⁵)(1−e^(−κt))/(1−p·e^(−κt)) dt]

其中 κ = d/λ，λ 为块体电子平均自由程，p 为镜面散射系数。

- p = 0：全漫射表面散射（默认），增强最大
- p = 1：全镜面散射，无尺寸效应（比值恒为 1）
- 大厚度极限（κ ≫ 1）：ρ_film/ρ_bulk ≈ 1 + 3(1−p)λ/(8d)
- 极薄膜（κ → 0）：电阻率发散（模型失效区，实现中数值保护）

实现采用 `scipy.integrate.quad` 精确数值积分。

## 4. 材料常数（materials.py）

| 常数 | 值 | 来源 |
|---|---|---|
| SILVER_BULK_RESISTIVITY | 1.59×10⁻⁸ Ω·m | CRC Handbook（室温块体银） |
| SILVER_MEAN_FREE_PATH_NM | 52 nm | 超薄银膜 FS 分析常用值（52–57 nm），M2 校准 |
| ITO_BULK_RESISTIVITY | 1.5×10⁻⁶ Ω·m | 典型溅射 ITO 文献值（工艺相关），M2 校准 |

## 5. 验证

- 单层：Rs = ρ/d（Ag 10 nm → 1.59 Ω/sq）
- 并联：两个相同层 → 方阻减半；零厚度层不贡献
- FS：κ≫1 解析极限 1+3λ/8d；p=1 无增强；厚度单调性（r(5) > r(10) > r(100) > 1）
- ITO/Ag/ITO：Rs ∈ (2, 4) Ω/sq，且低于纯 Ag（ITO 并联贡献）
- 全部见 `engine/tests/test_electrical.py`

## 6. 参考文献

- E. Fuchs, Proc. Cambridge Philos. Soc. 34, 100 (1938)
- E. H. Sondheimer, Adv. Phys. 1, 1 (1952)
- C. R. Tellier, A. J. Tosser, *Size Effects in Thin Films*, Elsevier (1982)
- H. S. Nalwa (ed.), *Handbook of Thin Film Materials*（Ag 电学参数综述）
