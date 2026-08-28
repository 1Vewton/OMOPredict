"""api 模块测试：FastAPI 端点（/health、/simulate）与引擎直算跨验。"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from omo.api import app
from omo.electrical import (
    ITO_BULK_RESISTIVITY,
    SILVER_BULK_RESISTIVITY,
    SILVER_MEAN_FREE_PATH_NM,
    ConductiveLayer,
    sheet_resistance,
)
from omo.emi import ShieldingLayer, shielding_effectiveness
from omo.optics import ITO, SILVER, Layer, transfer_matrix

client = TestClient(app)

ITO_AG_ITO = [
    {"material": "ITO", "thickness_nm": 40.0},
    {"material": "Ag", "thickness_nm": 10.0},
    {"material": "ITO", "thickness_nm": 40.0},
]


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"]


def test_simulate_matches_engine() -> None:
    """API 结果与直接调用引擎一致（跨验）。"""
    resp = client.post("/simulate", json={"layers": ITO_AG_ITO})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    wl = np.arange(380.0, 1001.0, 10.0)
    spec = transfer_matrix(
        [Layer(ITO, 40.0), Layer(SILVER, 10.0), Layer(ITO, 40.0)], wl
    )
    cond = [
        ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO"),
        ConductiveLayer(10.0, SILVER_BULK_RESISTIVITY, "Ag", SILVER_MEAN_FREE_PATH_NM),
        ConductiveLayer(40.0, ITO_BULK_RESISTIVITY, "ITO"),
    ]
    rs = sheet_resistance(cond)
    se = shielding_effectiveness(
        [ShieldingLayer.from_conductive_layer(c) for c in cond],
        np.arange(1.0, 19.0, 1.0),
    ).se_db

    assert body["sheet_resistance"] == pytest.approx(rs, rel=1e-9)
    assert len(body["transmittance"]) == wl.size
    assert body["transmittance"][0]["x"] == pytest.approx(380.0)
    assert body["transmittance"][0]["value"] == pytest.approx(spec.transmittance[0], rel=1e-6)
    assert len(body["se_db"]) == 18
    assert body["se_db"][0]["value"] == pytest.approx(se[0], abs=1e-6)


def test_simulate_custom_grids() -> None:
    resp = client.post(
        "/simulate",
        json={
            "layers": ITO_AG_ITO,
            "wavelengths_nm": [550.0],
            "freqs_ghz": [10.0],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["transmittance"]) == 1
    assert body["transmittance"][0]["x"] == pytest.approx(550.0)
    assert len(body["se_db"]) == 1


def test_simulate_unknown_material_422() -> None:
    resp = client.post(
        "/simulate", json={"layers": [{"material": "SiO2", "thickness_nm": 100.0}]}
    )
    assert resp.status_code == 422
    assert "SiO2" in resp.json()["detail"]


def test_simulate_empty_layers_422() -> None:
    resp = client.post("/simulate", json={"layers": []})
    assert resp.status_code == 422


def test_simulate_negative_thickness_422() -> None:
    resp = client.post(
        "/simulate", json={"layers": [{"material": "ITO", "thickness_nm": -5.0}]}
    )
    assert resp.status_code == 422


def test_simulate_insulator_no_rs() -> None:
    """纯玻璃（无导电层）：Rs 为 null、SE 为空。"""
    resp = client.post(
        "/simulate", json={"layers": [{"material": "glass", "thickness_nm": 1e6}]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sheet_resistance"] is None
    assert body["se_db"] == []
