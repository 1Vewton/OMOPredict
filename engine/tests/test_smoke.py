"""冒烟测试：验证 omo 包骨架可导入、版本一致、常数模块自洽。"""

from __future__ import annotations

import importlib
import math

from omo.constants import (
    SPEED_OF_LIGHT,
    VACUUM_IMPEDANCE,
    VACUUM_PERMEABILITY,
    VACUUM_PERMITTIVITY,
)


def test_version() -> None:
    import omo

    assert omo.__version__ == "0.1.0"


def test_subpackages_importable() -> None:
    # 所有子包应可导入，且每个包都有职责说明文档字符串（Go 式包划分骨架）
    for name in (
        "optics",
        "electrical",
        "emi",
        "optimize",
        "neural",
        "benchmark",
        "api",
        "cli",
    ):
        mod = importlib.import_module(f"omo.{name}")
        assert mod.__doc__, f"omo.{name} 缺少包文档字符串"


def test_constants_self_consistent() -> None:
    # Z0 = sqrt(μ0/ε0)
    z0_calc = math.sqrt(VACUUM_PERMEABILITY / VACUUM_PERMITTIVITY)
    assert math.isclose(z0_calc, VACUUM_IMPEDANCE, rel_tol=1e-9)
    # c = 1/sqrt(μ0·ε0)
    c_calc = 1.0 / math.sqrt(VACUUM_PERMEABILITY * VACUUM_PERMITTIVITY)
    assert math.isclose(c_calc, SPEED_OF_LIGHT, rel_tol=1e-9)
