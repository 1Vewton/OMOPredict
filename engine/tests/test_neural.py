"""neural 模块单元测试：数据生成、训练、可复现性、验证、保存/加载。"""

from __future__ import annotations

import numpy as np
import pytest

from omo.neural import (
    SurrogateConfig,
    SurrogateDataset,
    SurrogateModel,
    SurrogatePredictions,
    SurrogateValidationReport,
    TrainConfig,
    generate_dataset,
    validate,
)


def small_config(n_samples: int = 300, seed: int = 1) -> SurrogateConfig:
    return SurrogateConfig(n_samples=n_samples, seed=seed)


def small_train_config() -> TrainConfig:
    return TrainConfig(hidden=(32,), epochs=15, batch_size=64, patience=5, seed=0)


def test_generate_dataset_shapes_and_ranges() -> None:
    ds = generate_dataset(small_config(200))
    assert isinstance(ds, SurrogateDataset)
    assert ds.n_samples == 200
    assert ds.thicknesses.shape == (200, 3)
    assert ds.transmittance.shape == (200, len(ds.config.wavelengths_nm))
    assert ds.se_db.shape == (200, len(ds.config.freqs_ghz))
    assert ds.log10_rs.shape == (200,)
    assert np.all((ds.transmittance >= 0.0) & (ds.transmittance <= 1.0))
    assert np.all(ds.log10_rs > 0)
    assert np.all(ds.se_db > 0)
    assert ds.pipeline_version


def test_generate_dataset_deterministic() -> None:
    a = generate_dataset(small_config(100, seed=5))
    b = generate_dataset(small_config(100, seed=5))
    np.testing.assert_array_equal(a.thicknesses, b.thicknesses)
    np.testing.assert_array_equal(a.transmittance, b.transmittance)
    np.testing.assert_array_equal(a.log10_rs, b.log10_rs)


def test_boundary_coverage() -> None:
    """边界采样：约 20% 样本至少一个厚度落在 min/max 上。"""
    ds = generate_dataset(small_config(400))
    lo_o, hi_o = ds.config.oxide_bounds_nm
    lo_m, hi_m = ds.config.metal_bounds_nm
    at_boundary = (
        np.isin(ds.thicknesses[:, 0], [lo_o, hi_o])
        | np.isin(ds.thicknesses[:, 1], [lo_m, hi_m])
        | np.isin(ds.thicknesses[:, 2], [lo_o, hi_o])
    )
    frac = float(at_boundary.mean())
    assert 0.1 < frac < 0.5


def test_train_and_predict_small() -> None:
    ds = generate_dataset(small_config(300))
    model = SurrogateModel(ds.config, small_train_config())
    history = model.train(ds)
    assert history["val_loss_best"] < 1.0  # 归一化空间优于均值预测

    pred = model.predict(np.array([[40.0, 10.0, 40.0]]))
    assert isinstance(pred, SurrogatePredictions)
    assert pred.transmittance.shape == (1, len(ds.config.wavelengths_nm))
    assert pred.sheet_resistance.shape == (1,)
    assert pred.se_db.shape == (1, len(ds.config.freqs_ghz))
    assert np.all(np.isfinite(pred.transmittance))
    assert pred.sheet_resistance[0] > 0

    pred2 = model.predict([40.0, 10.0, 40.0])  # 标量 3 元组输入
    assert pred2.transmittance.shape == (1, len(ds.config.wavelengths_nm))
    with pytest.raises(ValueError):
        model.predict([40.0, 10.0])


def test_training_reproducible() -> None:
    ds = generate_dataset(small_config(300, seed=3))
    h1 = SurrogateModel(ds.config, small_train_config()).train(ds)
    h2 = SurrogateModel(ds.config, small_train_config()).train(ds)
    assert h1["val_loss_best"] == pytest.approx(h2["val_loss_best"], rel=1e-6)


def test_validate_report(tmp_path) -> None:
    train = generate_dataset(small_config(300, seed=1))
    test = generate_dataset(small_config(100, seed=2))  # 不同种子防泄漏
    model = SurrogateModel(train.config, small_train_config())
    model.train(train)
    report = validate(model, test)
    assert isinstance(report, SurrogateValidationReport)
    assert report.n_test == 100
    assert all(
        np.isfinite(v)
        for v in (
            report.transmittance_mae,
            report.rs_log10_mae,
            report.se_mae_db,
        )
    )
    assert "oxide_nm" in report.train_domain
    out = tmp_path / "report.json"
    report.save_json(out)
    assert out.exists() and out.stat().st_size > 0


def test_save_load_roundtrip(tmp_path) -> None:
    ds = generate_dataset(small_config(300, seed=4))
    model = SurrogateModel(ds.config, small_train_config())
    model.train(ds)
    path = tmp_path / "surrogate.pt"
    model.save(path)
    loaded = SurrogateModel.load(path)
    x = np.array([[40.0, 10.0, 40.0], [50.0, 12.0, 50.0]])
    np.testing.assert_allclose(
        model.predict(x).transmittance, loaded.predict(x).transmittance, atol=1e-6
    )
    np.testing.assert_allclose(
        model.predict(x).sheet_resistance,
        loaded.predict(x).sheet_resistance,
        atol=1e-6,
    )
    np.testing.assert_allclose(
        model.predict(x).se_db, loaded.predict(x).se_db, atol=1e-6
    )
