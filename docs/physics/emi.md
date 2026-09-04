# 电磁屏蔽效能模型（omo.emi）

> 状态：M1 已实现（`engine/src/omo/emi/shielding.py`、`materials.py`）。
> 本文档与代码同步维护（AGENTS.md 守则第 10 条）。

## 1. 模型概述

对多层膜（垂直入射平面波，两侧自由空间），计算屏蔽效能
SE = 20·log₁₀(E_i/E_t) [dB]（自由空间两侧功率 ∝ |E|²）。

## 2. 传输线模型（精确，多层）

每层视为一段传输线，特征阻抗 η_j 与传播常数 γ_j：

    η_j = sqrt(j·ω·μ_j / (σ_j + j·ω·ε_j))
    γ_j = sqrt(j·ω·μ_j·(σ_j + j·ω·ε_j))

其中 μ_j = μ₀·μ_rj、ε_j = ε₀·ε_rj、ω = 2π·f；γ、η 取主分支（无源介质 Re ≥ 0）。

层 ABCD 矩阵：

    L_j = [[cosh(γ_j·d_j),  η_j·sinh(γ_j·d_j)],
           [sinh(γ_j·d_j)/η_j,      cosh(γ_j·d_j)]]

总矩阵 M = ∏L_j，出射介质波阻抗 η_s，则电场透射系数：

    t = E_t/E_i = 2η_s / (M11·η_s + M12 + η_0·η_s·M21 + η_0·M22)

SE = 20·log₁₀(1/|t|)。

实现要点：

- 全部复数算术；玻璃衬底作为 σ=0 的介质层计入（ε_r = 2.25）；
- 空层序列（无屏蔽）t=1、SE=0；
- SE 定义要求两侧介质相同（默认自由空间）；
- 数值限制：导电层总衰减 Σαd ≲ 100（cosh/sinh 溢出），毫米级实心金属板
  请用 Schelkunoff 组分公式评估。

## 3. Schelkunoff 组分分解（单层）

对单层均匀屏蔽体（两侧自由空间），SE 可精确分解（推导：将 1/t 展开）：

    SE_A = 20·log₁₀|e^{γd}|          （吸收损耗）
    SE_R = 20·log₁₀|(Z₀+η)²/(4Z₀η)|  （反射损耗）
    SE_M = 20·log₁₀|1 − q·e^{−2γd}|  （多次反射，q = ((Z₀−η)/(Z₀+η))²）

- 大厚度极限：SE_M → 0，SE_A ≈ 8.686·d/δ（δ = 1/√(πfμσ) 趋肤深度）；
- 薄膜极限：SE_M ≈ −SE_R（抵消），总 SE 由方阻决定（见第 4 节）；
- 组分和为精确分解，与传输线模型逐点一致（实现中用此性质做单元测试）。

## 4. 薄导电膜近似

透明导电膜（d ≪ δ）的 SE 由总方阻 Rs 决定：

    SE ≈ 20·log₁₀(1 + Z₀/(2·Rs))

该式可从传输线模型的薄膜极限（σ·d = 1/Rs，M ≈ [[1,0],[1/Rs,1]]）严格导出。
Rs 由 omo.electrical 计算（含 Fuchs–Sondheimer 尺寸效应）。

### 4.1 频率平坦性（常见疑问：SE(f) 为什么是一条直线）

**结论：薄导电膜（d ≪ δ）的 SE(f) 平直是物理正确行为，不是 bug。**

原因：

1. 上式**不含频率**——薄膜区 SE 只由 Rs 决定；
2. Rs 在 1–18 GHz 与频率无关（金属电导率色散要到 THz 级才显著，
   ω ≪ 弛豫频率）；
3. 例如 ITO(40)/Ag(10)/ITO(40)：SE = 33.704 dB @ 1/5/10/18 GHz（完全平直，
   传输线模型逐点一致到 <0.001 dB）。

**何时不再平直**：金属层厚到与趋肤深度可比（d ≳ δ）后，吸收损耗
SE_A = 8.686·d/δ 主导，且 δ = 1/√(πfμσ) ∝ 1/√f → SE 随频率上升（∝√f）。
示例：Ag 3.2 µm（≈5δ @10GHz）SE = 92.7 → 124.7 dB（1 → 18 GHz）。
"平线 vs 上升"反映屏蔽机制切换：薄层反射主导（与频率无关），厚层吸收主导（√f）。

**与文献一致**：真实测量的透明 ITO/Ag/ITO 薄膜同样平坦（如 Voronin 2025,
Materials 18, 5393：SE 均匀 25–30 dB 覆盖 10 MHz–1 THz，本项目 M2 对标数据集）。

**与实测的差异**：本模型是理想平直（精确到 0.001 dB）；真实样品因测试装置与
轻微色散会有 <1 dB 的波纹——属预期差异，不构成模型错误。

## 5. 材料参数（materials.py）

| 常数 | 值 | 来源 |
|---|---|---|
| SILVER_BULK_CONDUCTIVITY | 6.29×10⁷ S/m | 1/ρ_Ag（CRC Handbook，见 electrical） |
| ITO_BULK_CONDUCTIVITY | 6.67×10⁵ S/m | 1/ρ_ITO（参考值，工艺相关） |

含尺寸效应的有效电导率：`ShieldingLayer.from_conductive_layer`（σ_eff = 1/ρ_eff）。

## 6. 验证

- 薄膜近似解析值；10 nm Ag 单层与 Rs 公式一致（±0.2 dB）
- Schelkunoff 组分和与传输线模型严格一致（1e-6 dB）
- SE_A = 8.686·d/δ 解析值；厚层 SE ∝ √f、薄层频率平坦
- ITO/Ag/ITO：X 波段 SE ≈ 34 dB（文献 25–35 dB 范围）
- 玻璃介质不屏蔽（< 0.5 dB）；参数校验
- 全部见 `engine/tests/test_emi.py`

## 7. 参考文献

- S. A. Schelkunoff, *Electromagnetic Waves*, Van Nostrand (1943)
- C. R. Paul, *Introduction to Electromagnetic Compatibility*, 2nd ed., Wiley (2006)
- H. W. Ott, *Electromagnetic Compatibility Engineering*, Wiley (2009)
