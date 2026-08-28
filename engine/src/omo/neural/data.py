"""NN 代理模型训练数据：由物理引擎生成（M2.5）。

纪律（AGENTS.md §6.9）：
- 数据一律由物理引擎生成，固定随机种子、记录生成管线版本（可复现）；
- 采样覆盖参数空间边界（20% 边界样本，含角点）；
- 训练/验证/测试集用不同种子生成，防泄漏。

v1 范围：ITO/Ag/ITO 三层体系，输入为三个厚度（底氧化物/金属/顶氧化物），
材料固定（ITO 常数 n=1.8、Ag Drude、玻璃衬底）；输出 T(λ) 固定网格、
log₁₀(Rs)、SE(f) 固定网格。材料参数入特征为后续扩展。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# 数据生成管线版本（修改采样/物理模型/输出网格时递增）
PIPELINE_VERSION = "omo.neural.data-v1"


@dataclass(frozen=True)
class SurrogateConfig:
    """正向代理模型的数据域与输出网格配置。"""

    oxide_bounds_nm: tuple[float, float] = (20.0, 80.0)
    metal_bounds_nm: tuple[float, float] = (5.0, 20.0)
    wavelengths_nm: tuple[float, ...] = tuple(
        float(w) for w in np.arange(380.0, 1001.0, 10.0)
    )
    freqs_ghz: tuple[float, ...] = tuple(
        float(f) for f in np.arange(1.0, 19.0, 1.0)
    )
    n_samples: int = 20000
    seed: int = 42
    boundary_fraction: float = 0.2


@dataclass(frozen=True)
class SurrogateDataset:
    """一批物理引擎生成的样本。

    属性:
        config: 生成配置（含种子）
        thicknesses: (n, 3) —— [底氧化物, 金属, 顶氧化物] nm
        transmittance: (n, n_wl) —— 透过率（玻璃衬底）
        log10_rs: (n,) —— log₁₀(方阻/Ω·sq)
        se_db: (n, n_freq) —— 屏蔽效能（dB）
        pipeline_version: 数据管线版本
    """

    config: SurrogateConfig
    thicknesses: np.ndarray
    transmittance: np.ndarray
    log10_rs: np.ndarray
    se_db: np.ndarray
    pipeline_version: str = PIPELINE_VERSION

    @property
    def n_samples(self) -> int:
        return int(self.thicknesses.shape[0])


def _sample_thicknesses(
    rng: np.random.Generator, config: SurrogateConfig
) -> np.ndarray:
    """采样厚度：20% 边界样本（每维取 min/max，覆盖角点）+ 80% 内部均匀。"""
    n = config.n_samples
    lo_o, hi_o = config.oxide_bounds_nm
    lo_m, hi_m = config.metal_bounds_nm
    x = np.empty((n, 3), dtype=float)
    n_boundary = int(round(n * config.boundary_fraction))
    for i in range(n_boundary):
        x[i, 0] = rng.choice([lo_o, hi_o])
        x[i, 1] = rng.choice([lo_m, hi_m])
        x[i, 2] = rng.choice([lo_o, hi_o])
    n_inner = n - n_boundary
    x[n_boundary:, 0] = rng.uniform(lo_o, hi_o, n_inner)
    x[n_boundary:, 1] = rng.uniform(lo_m, hi_m, n_inner)
    x[n_boundary:, 2] = rng.uniform(lo_o, hi_o, n_inner)
    return x


def generate_dataset(config: SurrogateConfig | None = None) -> SurrogateDataset:
    """由物理引擎生成一批样本（固定种子，可复现）。

    对每个厚度组合运行：TMM 光学（玻璃衬底）、并联方阻（含 FS 尺寸效应）、
    传输线屏蔽模型。引擎是唯一数据源（NN 专项守则）。

    参数:
        config: 生成配置；None 用默认（n_samples=20000, seed=42）

    返回:
        SurrogateDataset
    """
    config = config or SurrogateConfig()
    rng = np.random.default_rng(config.seed)
    x = _sample_thicknesses(rng, config)

    from omo.electrical import (
        ITO_BULK_RESISTIVITY,
        SILVER_BULK_RESISTIVITY,
        SILVER_MEAN_FREE_PATH_NM,
        ConductiveLayer,
        sheet_resistance,
    )
    from omo.emi import ShieldingLayer, shielding_effectiveness
    from omo.optics import ITO, SILVER, Layer, transfer_matrix

    wl = np.array(config.wavelengths_nm, dtype=float)
    freqs = np.array(config.freqs_ghz, dtype=float)
    n = config.n_samples
    transmittance = np.empty((n, wl.size), dtype=float)
    log10_rs = np.empty(n, dtype=float)
    se_db = np.empty((n, freqs.size), dtype=float)

    for i in range(n):
        d_ox1, d_metal, d_ox2 = x[i]
        spec = transfer_matrix(
            [Layer(ITO, d_ox1), Layer(SILVER, d_metal), Layer(ITO, d_ox2)],
            wl,
            substrate_index=1.5,
        )
        transmittance[i] = spec.transmittance
        conductive = [
            ConductiveLayer(d_ox1, ITO_BULK_RESISTIVITY, "ITO"),
            ConductiveLayer(
                d_metal, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM
            ),
            ConductiveLayer(d_ox2, ITO_BULK_RESISTIVITY, "ITO"),
        ]
        log10_rs[i] = math.log10(sheet_resistance(conductive))
        se_db[i] = shielding_effectiveness(
            [ShieldingLayer.from_conductive_layer(c) for c in conductive], freqs
        ).se_db

    return SurrogateDataset(
        config=config,
        thicknesses=x,
        transmittance=transmittance,
        log10_rs=log10_rs,
        se_db=se_db,
    )
