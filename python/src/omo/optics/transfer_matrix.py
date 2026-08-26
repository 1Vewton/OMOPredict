"""传输矩阵法（TMM）多层膜光学求解器。

物理模型（特征矩阵法，Macleod 约定）：

对偏振 pol ∈ {s, p}，定义第 j 层光学导纳 η_j：
    s 偏振：η_j = ñ_j · cos θ_j
    p 偏振：η_j = ñ_j / cos θ_j
其中 ñ_j 为复折射率，θ_j 由复数斯涅尔定律给出：
    ñ_j · sin θ_j = n_0 · sin θ_0

相位厚度：δ_j = 2π · ñ_j · d_j · cos θ_j / λ

每层特征矩阵：
    M_j = [[cos δ_j,  −i·sin δ_j / η_j],
           [−i·η_j·sin δ_j,      cos δ_j]]
整体矩阵 M = M_1 · M_2 · … · M_L。令 [B, C]ᵀ = M · [1, η_s]ᵀ，则：
    R = |(η_0·B − C) / (η_0·B + C)|²
    T = 4·η_0·Re(η_s) / |η_0·B + C|²   （入射/出射介质均无吸收）
    A = 1 − R − T

符号约定说明：由切向场连续性推导，H = η·(E⁺ − E⁻)，正向波取 e^{+i·k·z}
（k 虚部为正表示吸收、波在 +z 方向衰减），得到上式的 −i 号特征矩阵；
若误用 +i 号约定，吸收层会出现 T > 1 的非物理解。

参考文献：
- H. A. Macleod, "Thin-Film Optical Filters", 5th ed., CRC Press (2017), Ch. 2
- E. Hecht, "Optics", 5th ed., Pearson (2016)

约定：厚度与波长单位均为 nm；n/k 无量纲；无散射假设下 T + R + A = 1。
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

IndexCallable = Callable[[npt.NDArray[np.floating]], npt.NDArray[np.complexfloating]]


@dataclass(frozen=True)
class Layer:
    """多层膜中的一层。

    参数:
        index: 复折射率 ñ = n + i·k（k > 0 表示吸收）；或接受波长数组、
            返回复折射率数组的可调用对象（用于色散材料，如 DrudeMaterial）
        thickness_nm: 层厚度（nm），必须 ≥ 0

    异常:
        ValueError: thickness_nm 为负
    """

    index: complex | IndexCallable
    thickness_nm: float

    def __post_init__(self) -> None:
        if self.thickness_nm < 0:
            raise ValueError(f"thickness_nm 必须 ≥ 0，收到 {self.thickness_nm}")

    def index_at(self, wavelengths_nm: npt.NDArray[np.floating]) -> npt.NDArray[np.complexfloating]:
        """求该层在波长网格上的复折射率数组。"""
        idx = self.index(wavelengths_nm) if callable(self.index) else self.index
        return np.asarray(idx, dtype=np.complex128) * np.ones_like(wavelengths_nm)


@dataclass(frozen=True)
class OpticalSpectrum:
    """TMM 计算结果。

    属性:
        wavelengths_nm: 波长网格（nm）
        transmittance: 透过率 T（0–1）
        reflectance: 反射率 R（0–1）
    """

    wavelengths_nm: npt.NDArray[np.floating]
    transmittance: npt.NDArray[np.floating]
    reflectance: npt.NDArray[np.floating]

    @property
    def absorptance(self) -> npt.NDArray[np.floating]:
        """吸收率 A = 1 − T − R（无散射假设）。"""
        return 1.0 - self.transmittance - self.reflectance

    def visible_average_transmittance(
        self, min_nm: float = 400.0, max_nm: float = 800.0
    ) -> float:
        """可见光（默认 400–800 nm）平均透过率（算术平均）。

        异常:
            ValueError: 波长网格不包含给定区间内的任何点
        """
        mask = (self.wavelengths_nm >= min_nm) & (self.wavelengths_nm <= max_nm)
        if not np.any(mask):
            raise ValueError(f"波长网格不包含 [{min_nm}, {max_nm}] nm 区间内的点")
        return float(np.mean(self.transmittance[mask]))


def transfer_matrix(
    stack: Sequence[Layer],
    wavelengths_nm: npt.ArrayLike,
    incident_index: complex = 1.0 + 0j,
    substrate_index: complex = 1.5 + 0j,
    angle_deg: float = 0.0,
    polarization: Literal["s", "p", "unpolarized"] = "unpolarized",
) -> OpticalSpectrum:
    """传输矩阵法：计算多层膜系的透过率 / 反射率光谱。

    参数:
        stack: 膜层序列；空序列表示裸界面（仅入射/出射介质界面）
        wavelengths_nm: 波长网格（nm），一维且全为正
        incident_index: 入射介质复折射率（默认空气 1.0，须无吸收）
        substrate_index: 出射介质复折射率（默认玻璃 1.5，须无吸收）
        angle_deg: 入射角（度），范围 [0, 90)
        polarization: "s"、"p" 或 "unpolarized"（s 与 p 的平均，默认）

    返回:
        OpticalSpectrum（透过率与反射率；吸收率经 absorptance 属性获取）

    异常:
        ValueError: 波长非一维/非正、角度越界、偏振未知、
            入射/出射介质有吸收、层厚度为负
    """
    wl = np.asarray(wavelengths_nm, dtype=float)
    if wl.ndim != 1 or wl.size == 0:
        raise ValueError("wavelengths_nm 必须是一维非空数组")
    if np.any(wl <= 0):
        raise ValueError("wavelengths_nm 必须全为正")
    if not 0.0 <= angle_deg < 90.0:
        raise ValueError(f"angle_deg 必须在 [0, 90) 内，收到 {angle_deg}")
    if polarization not in ("s", "p", "unpolarized"):
        raise ValueError(f"polarization 必须为 's'/'p'/'unpolarized'，收到 {polarization!r}")

    n_inc = complex(incident_index)
    n_sub = complex(substrate_index)
    if not (np.isclose(n_inc.imag, 0.0) and np.isclose(n_sub.imag, 0.0)):
        raise ValueError("入射/出射介质必须无吸收（虚部为 0）")

    layers = list(stack)
    n_layers = len(layers)
    if n_layers:
        idx = np.stack([layer.index_at(wl) for layer in layers])  # (L, W)
    else:
        idx = np.empty((0, wl.size), dtype=np.complex128)

    sin_t0 = math.sin(math.radians(angle_deg))
    cos_t0 = math.cos(math.radians(angle_deg))

    # 复数斯涅尔定律：cos θ_j = sqrt(1 − (n0·sinθ0 / ñ_j)²)
    cos_t = np.sqrt(1.0 - (n_inc.real * sin_t0 / idx) ** 2)
    # 出射介质中的 cos θ_s（入射介质无吸收，n_sub 无吸收 → 恒为实数）
    cos_t_s = np.sqrt(1.0 - (n_inc.real * sin_t0 / n_sub) ** 2)

    thickness = np.array([layer.thickness_nm for layer in layers], dtype=float)
    delta = 2.0 * np.pi * idx * thickness[:, None] * cos_t / wl[None, :]  # (L, W)

    r_arr: dict[str, np.ndarray] = {}
    t_arr: dict[str, np.ndarray] = {}
    for pol in ("s", "p"):
        if pol == "s":
            eta0 = n_inc * cos_t0
            eta_s = n_sub * cos_t_s
            eta = idx * cos_t
        else:
            eta0 = n_inc / cos_t0
            eta_s = n_sub / cos_t_s
            eta = idx / cos_t

        cos_d = np.cos(delta)
        sin_d = np.sin(delta)
        m = np.empty((n_layers, wl.size, 2, 2), dtype=np.complex128)
        m[..., 0, 0] = cos_d
        m[..., 1, 1] = cos_d
        m[..., 0, 1] = -1j * sin_d / eta
        m[..., 1, 0] = -1j * eta * sin_d

        total = np.tile(np.eye(2, dtype=np.complex128), (wl.size, 1, 1))
        for j in range(n_layers):
            total = np.einsum("wij,wjk->wik", total, m[j])

        b = total[:, 0, 0] + total[:, 0, 1] * eta_s
        c = total[:, 1, 0] + total[:, 1, 1] * eta_s
        denom = eta0 * b + c
        r_arr[pol] = np.abs((eta0 * b - c) / denom) ** 2
        t_arr[pol] = (4.0 * eta0.real * eta_s.real) / np.abs(denom) ** 2

    if polarization == "s":
        r, t = r_arr["s"], t_arr["s"]
    elif polarization == "p":
        r, t = r_arr["p"], t_arr["p"]
    else:
        r = 0.5 * (r_arr["s"] + r_arr["p"])
        t = 0.5 * (t_arr["s"] + t_arr["p"])

    return OpticalSpectrum(wavelengths_nm=wl, transmittance=t, reflectance=r)
