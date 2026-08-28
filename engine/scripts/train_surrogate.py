"""NN 代理模型训练脚本（M2.5 可复现交付）。

用法：
    cd engine && uv run python scripts/train_surrogate.py

生成 20k 训练样本 + 3k 独立测试样本（不同种子），训练 MLP，
输出验证报告（docs/benchmarks/surrogate_report.json）与模型
（artifacts/surrogate_ito_ag_ito.pt，已 gitignore）。
"""

from __future__ import annotations

import time
from pathlib import Path

from omo.neural import SurrogateConfig, SurrogateModel, generate_dataset, validate

ENGINE_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ENGINE_ROOT / "artifacts"
REPORT_PATH = ENGINE_ROOT.parent / "docs" / "benchmarks" / "surrogate_report.json"

TRAIN_CONFIG = SurrogateConfig(n_samples=20_000, seed=42)
TEST_CONFIG = SurrogateConfig(n_samples=3_000, seed=7)  # 不同种子防泄漏


def main() -> None:
    t0 = time.time()
    print("生成训练数据 20000 样本...")
    train = generate_dataset(TRAIN_CONFIG)
    print(f"  用时 {time.time() - t0:.1f}s")

    t0 = time.time()
    print("训练 MLP (256-128)...")
    model = SurrogateModel(train.config)
    history = model.train(train)
    print(
        f"  用时 {time.time() - t0:.1f}s, "
        f"val_loss={history['val_loss_best']:.4f}, epochs={history['epochs_run']}"
    )

    t0 = time.time()
    print("生成独立测试集 3000 样本（不同种子）...")
    test = generate_dataset(TEST_CONFIG)
    print(f"  用时 {time.time() - t0:.1f}s")

    print("验证（物理引擎为基准）...")
    report = validate(model, test)
    print(f"  T  MAE={report.transmittance_mae:.4f}  RMSE={report.transmittance_rmse:.4f}")
    print(
        f"  Rs 相对误差={report.rs_relative_mae * 100:.1f}%  "
        f"(log10 MAE={report.rs_log10_mae:.4f})"
    )
    print(f"  SE MAE={report.se_mae_db:.2f} dB  RMSE={report.se_rmse_db:.2f} dB")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    model_path = ARTIFACT_DIR / "surrogate_ito_ag_ito.pt"
    model.save(model_path)
    report.save_json(REPORT_PATH)
    print(f"已保存: {model_path}")
    print(f"已保存: {REPORT_PATH}")


if __name__ == "__main__":
    main()
