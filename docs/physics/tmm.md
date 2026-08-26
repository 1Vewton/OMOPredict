# TMM 光学模型（omo.optics）

> 状态：M1 已实现（`python/src/omo/optics/transfer_matrix.py`、`drude.py`）。
> 本文档与代码同步维护（AGENTS.md 守则第 10 条）。

## 1. 模型概述

对 N 层各向同性薄膜（入射介质 0 → 层 1..N → 出射介质 s），给定波长 λ、入射角 θ₀、
各层复折射率 ñⱼ = nⱼ + i·kⱼ 与厚度 dⱼ，计算透过率 T、反射率 R、吸收率 A。

## 2. 特征矩阵法（Macleod 约定）

对偏振 pol ∈ {s, p}，定义第 j 层光学导纳：

    s 偏振：ηⱼ = ñⱼ · cos θⱼ
    p 偏振：ηⱼ = ñⱼ / cos θⱼ

θⱼ 由复数斯涅尔定律确定：

    ñⱼ · sin θⱼ = n₀ · sin θ₀
    cos θⱼ = sqrt(1 − (n₀·sin θ₀ / ñⱼ)²)

相位厚度：

    δⱼ = 2π · ñⱼ · dⱼ · cos θⱼ / λ

每层特征矩阵：

    Mⱼ = [[cos δⱼ,        i·sin δⱼ / ηⱼ],
          [i·ηⱼ·sin δⱼ,          cos δⱼ]]

整体矩阵 M = M₁·M₂·…·M_N。令 [B, C]ᵀ = M·[1, η_s]ᵀ，则（入射/出射介质均无吸收）：

    R = |(η₀·B − C) / (η₀·B + C)|²
    T = 4·η₀·Re(η_s) / |η₀·B + C|²
    A = 1 − R − T

实现要点：

- 所有计算使用复数算术，吸收层（k > 0）自然处理；
- 非偏振结果取 s 与 p 的平均：T = (T_s + T_p)/2；
- 空层序列（stack = []）表示裸界面，矩阵乘积退化为单位阵。

## 3. Drude 金属介电函数

    ε(ω) = ε_∞ − ω_p² / (ω² + i·γ·ω)

波长与光子能量换算：E[eV] = h·c/(e·λ[nm]) ≈ 1239.84 eV·nm / λ[nm]。
实现中 ω_p、γ 以能量单位给出（ħ·ω_p、ħ·γ），分解为：

    ε' = ε_∞ − ω_p²/(ω² + γ²)
    ε'' = ω_p²·γ / (ω·(ω² + γ²))

复折射率由 ñ = sqrt(ε) 得到，分支约定 Re(ñ) ≥ 0。

内置 Ag 参数（`SILVER`）：ε_∞ = 3.7，ħ·ω_p = 9.1 eV，ħ·γ = 0.02 eV——
对 Johnson & Christy (1972) 实测光学常数的 Drude 拟合，广泛见于 OMO 体系仿真文献；
M2 对标阶段将用实测数据校准。

## 4. 约定与假设

- 单位：厚度 nm、波长 nm；n/k 无量纲
- 无散射假设：T + R + A = 1
- 入射/出射介质必须无吸收（默认空气 1.0 / 玻璃 1.5）
- 入射角范围 [0, 90)°；出射界面不处理全内反射（n₀ < n_s 时不存在）
- 忽略膜间粗糙度、界面扩散层（M2 对标时作为系统误差讨论）

## 5. 验证

- 裸界面：与 Fresnel 公式一致（垂直与斜入射、s/p）
- 单层无吸收膜：与 Airy 解析式一致
- 四分之一波增透（n₁ = √(n₀·n_s)）：设计波长 R → 0
- 半波膜 / 极薄层：回归裸界面结果
- 吸收层：0 ≤ T, R, A ≤ 1 且 A > 0
- s/p 垂直入射一致、斜入射分裂、非偏振为平均
- 全部见 `python/tests/test_transfer_matrix.py`、`test_drude.py`

## 6. 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., CRC Press (2017), Ch. 2
- E. Hecht, *Optics*, 5th ed., Pearson (2016)
- P. B. Johnson, R. W. Christy, "Optical constants of the noble metals",
  Phys. Rev. B 6, 4370 (1972)
- Tiesinga et al., "CODATA recommended values of the fundamental physical constants",
  Rev. Mod. Phys. 93, 025010 (2021)
