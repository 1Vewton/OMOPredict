"""代理模型验证：与物理引擎在独立测试集上对比（引擎为唯一基准，M2.5）。

- 测试集由不同种子生成（与训练数据无泄漏）；
- 指标：T 绝对 MAE/RMSE、Rs log₁₀ MAE 与相对 MAE、SE dB MAE/RMSE；
- 报告训练域边界（外推风险基线）：预测超出训练域属于外推，精度不保证。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from omo.neural.data import SurrogateConfig, SurrogateDataset
from omo.neural.model import SurrogateModel


@dataclass(frozen=True)
class SurrogateValidationReport:
    """代理模型 vs 物理引擎的验证报告。"""

    n_test: int
    transmittance_mae: float
    transmittance_rmse: float
    rs_log10_mae: float
    rs_relative_mae: float
    se_mae_db: float
    se_rmse_db: float
    train_domain: dict[str, list[float]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_test": self.n_test,
            "transmittance_mae": self.transmittance_mae,
            "transmittance_rmse": self.transmittance_rmse,
            "rs_log10_mae": self.rs_log10_mae,
            "rs_relative_mae": self.rs_relative_mae,
            "se_mae_db": self.se_mae_db,
            "se_rmse_db": self.se_rmse_db,
            "train_domain": self.train_domain,
        }

    def save_json(self, path: str | Path) -> None:
        Path(path).write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )


def validate(
    model: SurrogateModel, test_dataset: SurrogateDataset
) -> SurrogateValidationReport:
    """在独立测试集（引擎生成，不同种子）上评估代理模型精度。

    参数:
        model: 已训练的代理模型
        test_dataset: 独立测试数据（物理引擎输出即基准）

    返回:
        SurrogateValidationReport
    """
    pred = model.predict(test_dataset.thicknesses)
    meas_t = test_dataset.transmittance
    meas_rs = 10.0 ** test_dataset.log10_rs
    meas_se = test_dataset.se_db

    t_err = np.abs(pred.transmittance - meas_t)
    rs_log10_err = np.abs(np.log10(pred.sheet_resistance) - test_dataset.log10_rs)
    rs_rel_err = np.abs(pred.sheet_resistance - meas_rs) / meas_rs
    se_err = np.abs(pred.se_db - meas_se)

    cfg: SurrogateConfig = model.config
    return SurrogateValidationReport(
        n_test=test_dataset.n_samples,
        transmittance_mae=float(np.mean(t_err)),
        transmittance_rmse=float(np.sqrt(np.mean(t_err**2))),
        rs_log10_mae=float(np.mean(rs_log10_err)),
        rs_relative_mae=float(np.mean(rs_rel_err)),
        se_mae_db=float(np.mean(se_err)),
        se_rmse_db=float(np.sqrt(np.mean(se_err**2))),
        train_domain={
            "oxide_nm": list(cfg.oxide_bounds_nm),
            "metal_nm": list(cfg.metal_bounds_nm),
        },
    )
