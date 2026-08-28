"""正向代理模型：MLP 逼近物理引擎的「厚度 → 性能」映射（M2.5）。

结构：输入 3 维厚度 → 隐藏层（ReLU）→ 输出
[T(λ) n_wl 点, log₁₀(Rs), SE(f) n_freq 点]。

- 输入与目标均做 z-score 归一化（统计量取自训练集，随模型保存）；
- 固定随机种子（torch + numpy），训练可复现；
- 早停（验证集）防过拟合；模型交付附带配置、管线版本与验证报告
  （AGENTS.md §6.9：不交付"黑盒权重"）。

物理引擎仍是唯一验证基准：本模型仅作仿真加速器（见 validate.py）。
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

from omo.neural.data import PIPELINE_VERSION, SurrogateConfig, SurrogateDataset


@dataclass(frozen=True)
class TrainConfig:
    """训练超参数（随模型保存，保证可复现）。"""

    hidden: tuple[int, ...] = (256, 128)
    epochs: int = 120
    batch_size: int = 256
    lr: float = 1e-3
    val_fraction: float = 0.1
    patience: int = 12
    seed: int = 0


@dataclass(frozen=True)
class SurrogatePredictions:
    """预测结果（反归一化到物理单位）。"""

    thicknesses: np.ndarray  # (n, 3) nm
    transmittance: np.ndarray  # (n, n_wl)
    sheet_resistance: np.ndarray  # (n,) Ω/sq
    se_db: np.ndarray  # (n, n_freq)


class SurrogateModel:
    """正向代理模型（训练 / 预测 / 保存 / 加载）。"""

    def __init__(
        self, config: SurrogateConfig, train_config: TrainConfig | None = None
    ) -> None:
        self.config = config
        self.train_config = train_config or TrainConfig()
        self._build_net()

    # ------------------------------------------------------------------
    # 网络
    # ------------------------------------------------------------------

    def _build_net(self) -> None:
        n_in = 3
        n_out = (
            len(self.config.wavelengths_nm) + 1 + len(self.config.freqs_ghz)
        )
        dims = [n_in, *self.train_config.hidden, n_out]
        layers: list[nn.Module] = []
        for i in range(len(dims) - 1):
            layers.append(nn.Linear(dims[i], dims[i + 1]))
            if i < len(dims) - 2:
                layers.append(nn.ReLU())
        self.net = nn.Sequential(*layers)
        self.n_out = n_out

    # ------------------------------------------------------------------
    # 归一化
    # ------------------------------------------------------------------

    def _fit_scalers(self, x: np.ndarray, y: np.ndarray) -> None:
        self.x_mean = torch.tensor(x.mean(axis=0), dtype=torch.float32)
        self.x_std = torch.tensor(x.std(axis=0) + 1e-8, dtype=torch.float32)
        self.y_mean = torch.tensor(y.mean(axis=0), dtype=torch.float32)
        self.y_std = torch.tensor(y.std(axis=0) + 1e-8, dtype=torch.float32)

    def _norm_x(self, x: torch.Tensor) -> torch.Tensor:
        return (x - self.x_mean) / self.x_std

    def _denorm_y(self, y: torch.Tensor) -> torch.Tensor:
        return y * self.y_std + self.y_mean

    # ------------------------------------------------------------------
    # 训练
    # ------------------------------------------------------------------

    def train(self, dataset: SurrogateDataset) -> dict[str, float]:
        """训练 MLP（内部划分早停验证集），返回验证损失与轮数。

        参数:
            dataset: 物理引擎生成的数据（训练/早停验证由此划分）

        返回:
            {"val_loss_best": float, "epochs_run": int}
        """
        torch.manual_seed(self.train_config.seed)
        np.random.seed(self.train_config.seed)

        x = torch.tensor(dataset.thicknesses, dtype=torch.float32)
        y = torch.tensor(
            np.concatenate(
                [dataset.transmittance, dataset.log10_rs[:, None], dataset.se_db],
                axis=1,
            ),
            dtype=torch.float32,
        )
        n = x.shape[0]
        n_val = max(1, int(n * self.train_config.val_fraction))
        perm = torch.randperm(n)
        val_idx, train_idx = perm[:n_val], perm[n_val:]
        self._fit_scalers(x[train_idx].numpy(), y[train_idx].numpy())
        xt = self._norm_x(x[train_idx])
        yt = (y[train_idx] - self.y_mean) / self.y_std
        xv = self._norm_x(x[val_idx])
        yv = (y[val_idx] - self.y_mean) / self.y_std

        optimizer = torch.optim.Adam(self.net.parameters(), lr=self.train_config.lr)
        loss_fn = nn.MSELoss()
        best_val = math.inf
        best_state: dict[str, torch.Tensor] | None = None
        patience_left = self.train_config.patience
        epochs_run = 0

        for epoch in range(self.train_config.epochs):
            self.net.train()
            for b in range(0, len(xt), self.train_config.batch_size):
                optimizer.zero_grad()
                out = self.net(xt[b : b + self.train_config.batch_size])
                loss = loss_fn(out, yt[b : b + self.train_config.batch_size])
                loss.backward()
                optimizer.step()
            self.net.eval()
            with torch.no_grad():
                val_loss = float(loss_fn(self.net(xv), yv))
            epochs_run = epoch + 1
            if val_loss < best_val:
                best_val = val_loss
                best_state = {k: v.clone() for k, v in self.net.state_dict().items()}
                patience_left = self.train_config.patience
            else:
                patience_left -= 1
                if patience_left <= 0:
                    break

        if best_state is not None:
            self.net.load_state_dict(best_state)
        return {"val_loss_best": best_val, "epochs_run": epochs_run}

    # ------------------------------------------------------------------
    # 预测
    # ------------------------------------------------------------------

    def predict(self, thicknesses: np.ndarray) -> SurrogatePredictions:
        """预测性能。输入 (n,3) 或 (3,) 厚度（nm），输出反归一化结果。

        异常:
            ValueError: 输入维度不是 3
        """
        x = np.asarray(thicknesses, dtype=float)
        if x.ndim == 1:
            x = x[None, :]
        if x.ndim != 2 or x.shape[1] != 3:
            raise ValueError(f"thicknesses 应为 (n,3) 或 (3,)，收到 {x.shape}")
        self.net.eval()
        with torch.no_grad():
            y = self._denorm_y(
                self.net(self._norm_x(torch.tensor(x, dtype=torch.float32)))
            ).numpy()
        n_wl = len(self.config.wavelengths_nm)
        return SurrogatePredictions(
            thicknesses=x,
            transmittance=y[:, :n_wl],
            sheet_resistance=10.0 ** y[:, n_wl],
            se_db=y[:, n_wl + 1 :],
        )

    # ------------------------------------------------------------------
    # 保存 / 加载
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        """保存模型（配置 + 归一化统计 + 权重 + 管线版本）。"""
        payload: dict[str, Any] = {
            "config": asdict(self.config),
            "train_config": asdict(self.train_config),
            "pipeline_version": PIPELINE_VERSION,
            "x_mean": self.x_mean.tolist(),
            "x_std": self.x_std.tolist(),
            "y_mean": self.y_mean.tolist(),
            "y_std": self.y_std.tolist(),
            "state_dict": {k: v.tolist() for k, v in self.net.state_dict().items()},
        }
        torch.save(payload, Path(path))

    @classmethod
    def load(cls, path: str | Path) -> SurrogateModel:
        """从 save 产物恢复模型。"""
        payload = torch.load(Path(path), weights_only=False, map_location="cpu")
        model = cls(
            SurrogateConfig(**payload["config"]),
            TrainConfig(**payload["train_config"]),
        )
        model.x_mean = torch.tensor(payload["x_mean"], dtype=torch.float32)
        model.x_std = torch.tensor(payload["x_std"], dtype=torch.float32)
        model.y_mean = torch.tensor(payload["y_mean"], dtype=torch.float32)
        model.y_std = torch.tensor(payload["y_std"], dtype=torch.float32)
        model.net.load_state_dict(
            {k: torch.tensor(v) for k, v in payload["state_dict"].items()}
        )
        return model
