"""文献对标数据集：数据模型与 JSON 加载/校验。

数据集 JSON 结构（docs/benchmarks/*.json）：

    {
      "meta": {
        "id": "ito_ag_ito_kim2018",              # 必填，唯一标识
        "paper": {                                # 必填，DOI 用于溯源
          "title": "...", "authors": "...",
          "year": 2018, "doi": "10.xxxx/yyyy", "journal": "..."
        },
        "substrate": {"material": "glass", "index": 1.5},
        "extraction": {"method": "table", "note": "550nm 单点透过率"}
      },
      "records": [                                # 必填，至少 1 条
        {
          "id": "s1",
          "stack": [{"material": "ITO", "thickness_nm": 40.0}, ...],
          "measured": {                           # 任意子集（可缺项）
            "transmittance": [{"wavelength_nm": 550.0, "value": 0.87}],
            "reflectance":  [{"wavelength_nm": 550.0, "value": 0.05}],
            "sheet_resistance": 6.5,
            "se": [{"frequency_ghz": 10.0, "value": 28.0}],
            "se_x_band": 28.0
          }
        }
      ],
      "simulation": {                             # 可选：材料常数覆盖（M2.3 校准产物）
        "materials": {
          "ITO": {"optics": {"constant_index": [1.82, 0.0]},
                  "electrical": {"bulk_resistivity": 1.2e-6}},
          "Ag":  {"optics": {"drude": {"eps_inf": 3.7, "plasma_energy_ev": 9.1,
                                       "damping_energy_ev": 0.03}},
                  "electrical": {"mean_free_path_nm": 55.0}}
        }
      }
    }

约定：透过率/反射率为小数（0–1）；Rs 单位 Ω/sq；SE 单位 dB。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from omo.optics import DrudeMaterial


class SchemaError(ValueError):
    """数据集格式错误（消息含出错路径）。"""


@dataclass(frozen=True)
class PaperMeta:
    """论文元数据（DOI 必填，用于溯源）。"""

    title: str
    authors: str
    year: int
    doi: str
    journal: str = ""


@dataclass(frozen=True)
class SubstrateInfo:
    """衬底信息（默认玻璃 n=1.5，与引擎默认一致）。"""

    material: str = "glass"
    index: float = 1.5


@dataclass(frozen=True)
class ExtractionInfo:
    """数据提取条件（保证数据质量可追溯）。"""

    method: str  # "table" | "figure-digitized" | ...
    note: str = ""


@dataclass(frozen=True)
class DatasetMeta:
    id: str
    paper: PaperMeta
    substrate: SubstrateInfo = SubstrateInfo()
    extraction: ExtractionInfo = ExtractionInfo(method="unknown")


@dataclass(frozen=True)
class StackLayer:
    material: str
    thickness_nm: float


@dataclass(frozen=True)
class SpectralPoint:
    x: float  # 波长(nm) 或 频率(GHz)，含义由所属字段决定
    value: float


@dataclass(frozen=True)
class Measurements:
    """一条记录的实测数据（任意子集；全空视为纯结构数据）。"""

    transmittance: tuple[SpectralPoint, ...] = ()
    reflectance: tuple[SpectralPoint, ...] = ()
    sheet_resistance: float | None = None
    se: tuple[SpectralPoint, ...] = ()  # 频率点 (GHz, dB)
    se_x_band: float | None = None  # X 波段平均 (dB)

    @property
    def is_empty(self) -> bool:
        return not (
            self.transmittance
            or self.reflectance
            or self.sheet_resistance is not None
            or self.se
            or self.se_x_band is not None
        )


@dataclass(frozen=True)
class BenchmarkRecord:
    id: str
    stack: tuple[StackLayer, ...]
    measured: Measurements


@dataclass(frozen=True)
class OpticsOverride:
    """光学常数覆盖：常数复折射率 或 完整 Drude 参数（二者取一）。"""

    constant_index: complex | None = None
    drude: DrudeMaterial | None = None

    @property
    def is_empty(self) -> bool:
        return self.constant_index is None and self.drude is None


@dataclass(frozen=True)
class ElectricalOverride:
    """电学常数覆盖（ρ_bulk、λ、p，均为可选）。"""

    bulk_resistivity: float | None = None
    mean_free_path_nm: float | None = None
    specularity: float | None = None

    @property
    def is_empty(self) -> bool:
        return (
            self.bulk_resistivity is None
            and self.mean_free_path_nm is None
            and self.specularity is None
        )


@dataclass(frozen=True)
class MaterialOverrides:
    """单个材料的光学/电学覆盖。"""

    optics: OpticsOverride = OpticsOverride()
    electrical: ElectricalOverride = ElectricalOverride()

    @property
    def is_empty(self) -> bool:
        return self.optics.is_empty and self.electrical.is_empty


@dataclass(frozen=True)
class BenchmarkDataset:
    meta: DatasetMeta
    records: tuple[BenchmarkRecord, ...]
    simulation: Mapping[str, MaterialOverrides]  # material -> 覆盖（校准产物）


def load_dataset(path: str | Path) -> BenchmarkDataset:
    """从 JSON 文件加载并校验数据集。

    异常:
        SchemaError: 文件不存在 / JSON 非法 / 结构不合法
    """
    p = Path(path)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SchemaError(f"数据集文件不存在：{p}") from None
    except json.JSONDecodeError as exc:
        raise SchemaError(f"数据集 JSON 解析失败：{p}：{exc}") from None
    return parse_dataset(raw, source=str(p))


def parse_dataset(raw: Mapping[str, Any], source: str = "<dict>") -> BenchmarkDataset:
    """从字典解析数据集（供测试与内存构造复用）。

    异常:
        SchemaError: 结构不合法（消息含出错路径）
    """
    if not isinstance(raw, dict):
        raise SchemaError(f"{source}: 顶层必须是 JSON 对象")

    meta_raw = _require(raw, "meta", source)
    meta = _parse_meta(meta_raw, f"{source}.meta")

    records_raw = _require(raw, "records", source)
    if not isinstance(records_raw, list) or not records_raw:
        raise SchemaError(f"{source}.records: 必须是非空数组")
    records = tuple(
        _parse_record(r, f"{source}.records[{i}]") for i, r in enumerate(records_raw)
    )

    simulation = _parse_simulation(raw.get("simulation"), f"{source}.simulation")
    return BenchmarkDataset(meta=meta, records=records, simulation=simulation)


# ---------------------------------------------------------------------------
# 解析辅助
# ---------------------------------------------------------------------------


def _require(d: Mapping[str, Any], key: str, where: str) -> Any:
    if key not in d:
        raise SchemaError(f"{where}: 缺少必需字段 {key!r}")
    return d[key]


def _require_str(d: Mapping[str, Any], key: str, where: str) -> str:
    v = _require(d, key, where)
    if not isinstance(v, str) or not v.strip():
        raise SchemaError(f"{where}.{key}: 必须是非空字符串")
    return v.strip()


def _parse_float(v: Any, where: str, *, minimum: float | None = None) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SchemaError(f"{where}: 必须是数值")
    f = float(v)
    if minimum is not None and f < minimum:
        raise SchemaError(f"{where}: 必须 ≥ {minimum}，收到 {f}")
    return f


def _parse_int(v: Any, where: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise SchemaError(f"{where}: 必须是整数")
    return v


def _parse_optional_float(
    v: Any, where: str, *, minimum: float | None = None
) -> float | None:
    if v is None:
        return None
    return _parse_float(v, where, minimum=minimum)


def _parse_meta(d: Any, where: str) -> DatasetMeta:
    if not isinstance(d, dict):
        raise SchemaError(f"{where}: 必须是对象")
    paper_raw = _require(d, "paper", where)
    if not isinstance(paper_raw, dict):
        raise SchemaError(f"{where}.paper: 必须是对象")
    paper = PaperMeta(
        title=_require_str(paper_raw, "title", f"{where}.paper"),
        authors=_require_str(paper_raw, "authors", f"{where}.paper"),
        year=_parse_int(_require(paper_raw, "year", f"{where}.paper"), f"{where}.paper.year"),
        doi=_require_str(paper_raw, "doi", f"{where}.paper"),
        journal=paper_raw.get("journal", ""),
    )
    sub_raw = d.get("substrate")
    substrate = SubstrateInfo()
    if isinstance(sub_raw, dict):
        substrate = SubstrateInfo(
            material=str(sub_raw.get("material", "glass")),
            index=_parse_float(sub_raw.get("index", 1.5), f"{where}.substrate.index"),
        )
    ext_raw = d.get("extraction")
    extraction = ExtractionInfo(method="unknown")
    if isinstance(ext_raw, dict):
        extraction = ExtractionInfo(
            method=_require_str(ext_raw, "method", f"{where}.extraction"),
            note=str(ext_raw.get("note", "")),
        )
    return DatasetMeta(
        id=_require_str(d, "id", where),
        paper=paper,
        substrate=substrate,
        extraction=extraction,
    )


def _parse_record(d: Any, where: str) -> BenchmarkRecord:
    if not isinstance(d, dict):
        raise SchemaError(f"{where}: 必须是对象")
    rid = _require_str(d, "id", where)
    stack_raw = _require(d, "stack", where)
    if not isinstance(stack_raw, list) or not stack_raw:
        raise SchemaError(f"{where}.stack: 必须是非空数组")
    stack = tuple(
        StackLayer(
            material=_require_str(s, "material", f"{where}.stack[{i}]"),
            thickness_nm=_parse_float(
                _require(s, "thickness_nm", f"{where}.stack[{i}]"),
                f"{where}.stack[{i}].thickness_nm",
                minimum=0.0,
            ),
        )
        for i, s in enumerate(stack_raw)
    )
    measured = _parse_measurements(d.get("measured", {}), f"{where}.measured")
    return BenchmarkRecord(id=rid, stack=stack, measured=measured)


def _parse_measurements(d: Any, where: str) -> Measurements:
    if not isinstance(d, dict):
        raise SchemaError(f"{where}: 必须是对象")
    transmittance = _parse_points(
        d.get("transmittance"), f"{where}.transmittance", "wavelength_nm"
    )
    reflectance = _parse_points(
        d.get("reflectance"), f"{where}.reflectance", "wavelength_nm"
    )
    for pt in (*transmittance, *reflectance):
        if not 0.0 <= pt.value <= 1.0:
            raise SchemaError(
                f"{where}: 透过率/反射率必须在 [0,1]（小数），收到 {pt.value}"
            )
    return Measurements(
        transmittance=transmittance,
        reflectance=reflectance,
        sheet_resistance=_parse_optional_float(
            d.get("sheet_resistance"), f"{where}.sheet_resistance", minimum=0.0
        ),
        se=_parse_points(d.get("se"), f"{where}.se", "frequency_ghz"),
        se_x_band=_parse_optional_float(d.get("se_x_band"), f"{where}.se_x_band"),
    )


def _parse_points(raw: Any, where: str, x_key: str) -> tuple[SpectralPoint, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise SchemaError(f"{where}: 必须是数组")
    points = []
    for i, p in enumerate(raw):
        if not isinstance(p, dict):
            raise SchemaError(f"{where}[{i}]: 必须是对象")
        points.append(
            SpectralPoint(
                x=_parse_float(
                    _require(p, x_key, f"{where}[{i}]"),
                    f"{where}[{i}].{x_key}",
                    minimum=0.0,
                ),
                value=_parse_float(
                    _require(p, "value", f"{where}[{i}]"), f"{where}[{i}].value"
                ),
            )
        )
    return tuple(points)


def _parse_simulation(raw: Any, where: str) -> Mapping[str, MaterialOverrides]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SchemaError(f"{where}: 必须是对象")
    mats = raw.get("materials", {})
    if not isinstance(mats, dict):
        raise SchemaError(f"{where}.materials: 必须是对象")
    result: dict[str, MaterialOverrides] = {}
    for name, ov_raw in mats.items():
        if not isinstance(ov_raw, dict):
            raise SchemaError(f"{where}.materials.{name}: 必须是对象")
        result[str(name)] = MaterialOverrides(
            optics=_parse_optics_override(
                ov_raw.get("optics"), f"{where}.materials.{name}.optics"
            ),
            electrical=_parse_electrical_override(
                ov_raw.get("electrical"), f"{where}.materials.{name}.electrical"
            ),
        )
    return result


def _parse_optics_override(raw: Any, where: str) -> OpticsOverride:
    if raw is None:
        return OpticsOverride()
    if not isinstance(raw, dict):
        raise SchemaError(f"{where}: 必须是对象")
    const = raw.get("constant_index")
    drude = raw.get("drude")
    if const is not None and drude is not None:
        raise SchemaError(f"{where}: constant_index 与 drude 只能二选一")
    constant_index: complex | None = None
    if const is not None:
        if not (isinstance(const, list) and len(const) == 2):
            raise SchemaError(f"{where}.constant_index: 必须为 [n, k] 数组")
        constant_index = complex(float(const[0]), float(const[1]))
    drude_material: DrudeMaterial | None = None
    if drude is not None:
        if not isinstance(drude, dict):
            raise SchemaError(f"{where}.drude: 必须是对象")
        drude_material = DrudeMaterial(
            eps_inf=_parse_float(
                _require(drude, "eps_inf", f"{where}.drude"), f"{where}.drude.eps_inf"
            ),
            plasma_energy_ev=_parse_float(
                _require(drude, "plasma_energy_ev", f"{where}.drude"),
                f"{where}.drude.plasma_energy_ev",
            ),
            damping_energy_ev=_parse_float(
                _require(drude, "damping_energy_ev", f"{where}.drude"),
                f"{where}.drude.damping_energy_ev",
            ),
        )
    return OpticsOverride(constant_index=constant_index, drude=drude_material)


def _parse_electrical_override(raw: Any, where: str) -> ElectricalOverride:
    if raw is None:
        return ElectricalOverride()
    if not isinstance(raw, dict):
        raise SchemaError(f"{where}: 必须是对象")
    return ElectricalOverride(
        bulk_resistivity=_parse_optional_float(
            raw.get("bulk_resistivity"), f"{where}.bulk_resistivity", minimum=0.0
        ),
        mean_free_path_nm=_parse_optional_float(
            raw.get("mean_free_path_nm"), f"{where}.mean_free_path_nm", minimum=0.0
        ),
        specularity=_parse_optional_float(
            raw.get("specularity"), f"{where}.specularity", minimum=0.0
        ),
    )
