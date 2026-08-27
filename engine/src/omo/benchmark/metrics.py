"""对标误差指标：MAE / RMSE / 最大绝对误差 / 相对 MAE。"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class QuantityMetrics:
    """单个量的聚合误差（n 为样本点数）。"""

    n: int
    mae: float
    rmse: float
    max_abs_error: float
    relative_mae: float

    def to_dict(self) -> dict[str, float | int]:
        return {
            "n": self.n,
            "mae": self.mae,
            "rmse": self.rmse,
            "max_abs_error": self.max_abs_error,
            "relative_mae": self.relative_mae,
        }


def compute_metrics(predicted: np.ndarray, measured: np.ndarray) -> QuantityMetrics:
    """计算误差指标。

    参数:
        predicted / measured: 等长序列（仿真值 / 实测值）

    异常:
        ValueError: 长度不一致或为空
    """
    p = np.asarray(predicted, dtype=float)
    m = np.asarray(measured, dtype=float)
    if p.shape != m.shape or p.size == 0:
        raise ValueError(f"predicted 与 measured 必须等长且非空（{p.shape} vs {m.shape}）")
    err = np.abs(p - m)
    nonzero = m != 0.0
    relative_mae = (
        float(np.mean(err[nonzero] / np.abs(m[nonzero]))) if np.any(nonzero) else 0.0
    )
    return QuantityMetrics(
        n=int(p.size),
        mae=float(np.mean(err)),
        rmse=float(np.sqrt(np.mean(err**2))),
        max_abs_error=float(np.max(err)),
        relative_mae=relative_mae,
    )
