"""omo-cli —— 命令行入口。

用法示例：
    omo-cli --version
    omo-cli --info
    omo-cli optimize --min-t 0.85 --max-rs 12 --min-se 25
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from omo import __version__
from omo.optimize import (
    OmoSearchConfig,
    analyze_sensitivity,
    search_designs,
)
from omo.optimize.search import OptimizeReport
from omo.optimize.target import DesignTarget


def _build_optimize_parser(sub: argparse._SubParsersAction) -> None:
    """目标反推子命令：约束 → 扫描 → 候选 + 灵敏度 + 可选 JSON 报告。"""
    p = sub.add_parser("optimize", help="目标反推：按性能约束反推 OMO 三层膜厚组合")
    # 扫描空间
    g = p.add_argument_group("扫描空间（默认 ITO/Ag/ITO：外层 20–80 步长 4、金属 5–20 步长 1）")
    g.add_argument("--outer-min", type=float, dest="outer_min", default=None)
    g.add_argument("--outer-max", type=float, dest="outer_max", default=None)
    g.add_argument("--outer-step", type=float, dest="outer_step", default=None)
    g.add_argument("--metal-min", type=float, dest="metal_min", default=None)
    g.add_argument("--metal-max", type=float, dest="metal_max", default=None)
    g.add_argument("--metal-step", type=float, dest="metal_step", default=None)
    g.add_argument("--outer-material", default=None, help="外层材料（默认 ITO）")
    g.add_argument("--metal-material", default=None, help="金属层材料（默认 Ag）")
    g.add_argument("--substrate", type=float, default=None, help="衬底折射率（默认 1.5）")
    # 目标约束（0–1 分数；全缺省 = 按 FoM 排序的浏览扫描）
    g = p.add_argument_group("目标约束")
    g.add_argument("--min-t", type=float, dest="min_t", default=None,
                   help="可见光平均透过率下限（0–1，如 0.85）")
    g.add_argument("--max-rs", type=float, dest="max_rs", default=None,
                   help="方阻上限 Ω/sq（如 12）")
    g.add_argument("--min-se", type=float, dest="min_se", default=None,
                   help="频带内最小 SE 下限 dB")
    g.add_argument("--se-lo", type=float, dest="se_lo", default=8.2,
                   help="SE 频带下界 GHz（默认 8.2）")
    g.add_argument("--se-hi", type=float, dest="se_hi", default=12.4,
                   help="SE 频带下界 GHz（默认 12.4）")
    # 输出
    p.add_argument("--top-n", type=int, dest="top_n", default=None, help="返回候选数（默认 10）")
    p.add_argument("--json", type=str, dest="json_path", default=None,
                   help="同时把完整报告写入 JSON 文件")
    p.set_defaults(handler=_run_optimize)


def _run_optimize(args: argparse.Namespace) -> int:
    # ---- 目标 ----
    target = DesignTarget(
        min_visible_transmittance=args.min_t,
        max_sheet_resistance=args.max_rs,
        min_se_db=args.min_se,
        se_freq_range_ghz=(args.se_lo, args.se_hi),
    )
    # ---- 扫描配置（缺省字段用默认值）----
    cfg = OmoSearchConfig(
        outer_bounds_nm=(args.outer_min or 20.0, args.outer_max or 80.0),
        outer_step_nm=args.outer_step or 4.0,
        metal_bounds_nm=(args.metal_min or 5.0, args.metal_max or 20.0),
        metal_step_nm=args.metal_step or 1.0,
        outer_material=args.outer_material or "ITO",
        metal_material=args.metal_material or "Ag",
        substrate_index=args.substrate or 1.5,
        top_n=args.top_n or 10,
    )

    print("omo-cli optimize —— 目标反推（OMO 三层网格扫描，物理引擎求值）")
    print(f"体系：{cfg.materials[0]}/{cfg.materials[1]}/{cfg.materials[2]} "
          f"外层 {cfg.outer_bounds_nm[0]:g}–{cfg.outer_bounds_nm[1]:g} nm "
          f"(步长 {cfg.outer_step_nm:g}) · "
          f"金属 {cfg.metal_bounds_nm[0]:g}–{cfg.metal_bounds_nm[1]:g} nm "
          f"(步长 {cfg.metal_step_nm:g}) · 衬底 n={cfg.substrate_index:g}")
    if target.has_constraints:
        print("目标：" + "，".join(target.describe()))
    else:
        print("目标：无约束（按 FoM = T_vis^10/Rs 排序的浏览扫描）")

    # ---- 扫描 ----
    def _progress(done: int, total: int) -> None:
        print(f"\r  已求值 {done}/{total}", end="", flush=True)

    report = search_designs(target, cfg, progress_callback=_progress)
    print(f"\r扫描 {report.n_scanned} 组合 · 可行 {report.n_feasible} 组 · "
          f"用时 {report.elapsed_seconds:.1f}s")

    # ---- 候选表 ----
    if report.candidates:
        _print_candidates(report, show_se=args.min_se is not None)
    else:
        print("没有满足全部约束的候选。")
    if report.best_effort is not None:
        _print_best_effort(report)

    # ---- 最佳候选灵敏度 ----
    if report.candidates:
        sens = analyze_sensitivity(report.candidates[0], cfg.materials, target,
                                   substrate_index=cfg.substrate_index)
        print("\n最佳候选逐层灵敏度（Δ 每 nm）与工艺窗口：")
        print(f"  {'层':<6}{'材料':<6}{'厚度nm':>8}{'ΔFoM/FoM':>12}{'ΔT_vis':>12}"
              f"{'Δlog10Rs':>12}{'窗口±nm':>10}")
        for s in sens.layers:
            dlog = f"{s.dlog10_rs_per_nm:+.4f}" if s.dlog10_rs_per_nm is not None else "—"
            tol = f"{s.tolerance_nm:g}" if s.tolerance_nm is not None else "—"
            print(f"  {s.layer_index:<6}{s.material:<6}{s.thickness_nm:>8g}"
                  f"{s.dfom_rel_per_nm:>+12.4f}{s.dt_abs_per_nm:>+12.5f}{dlog:>12}{tol:>10}")

    # ---- JSON 导出 ----
    if args.json_path:
        Path(args.json_path).write_text(
            json.dumps(report.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n报告已写入 {args.json_path}")
    return 0


def _print_candidates(report: OptimizeReport, show_se: bool) -> None:
    """打印可行候选表（按 FoM 降序）。"""
    print(f"\nTop {len(report.candidates)} 可行候选（按 FoM = T_vis^10/Rs 排序）：")
    head = f"  {'#':<4}{'外层nm':>8}{'金属nm':>8}{'外层nm':>8}{'T_vis':>9}{'Rs Ω/sq':>10}"
    if show_se:
        head += f"{'SE_min dB':>11}"
    head += f"{'FoM':>12}"
    print(head)
    for i, m in enumerate(report.candidates, start=1):
        row = (f"  {i:<4}{m.thicknesses_nm[0]:>8g}{m.thicknesses_nm[1]:>8g}"
               f"{m.thicknesses_nm[2]:>8g}{m.visible_transmittance:>9.4f}"
               f"{m.sheet_resistance if m.sheet_resistance is not None else float('nan'):>10.2f}")
        if show_se:
            row += f"{m.se_min_db if m.se_min_db is not None else float('nan'):>11.2f}"
        row += f"{m.fom if m.fom is not None else 0.0:>12.5g}"
        print(row)


def _print_best_effort(report: OptimizeReport) -> None:
    """无可行解时提示最接近候选（全体 FoM 最高）。"""
    m = report.best_effort
    assert m is not None
    print("\n最接近参考（不满足全部约束，全体 FoM 最高）：")
    print(f"  外层 {m.thicknesses_nm[0]:g} / 金属 {m.thicknesses_nm[1]:g} / "
          f"外层 {m.thicknesses_nm[2]:g} nm · T_vis = {m.visible_transmittance:.4f} · "
          f"Rs = {m.sheet_resistance if m.sheet_resistance is not None else float('nan'):.2f}"
          " Ω/sq · "
          f"FoM = {m.fom if m.fom is not None else 0.0:.5g}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="omo-cli",
        description="OMO 纳米多层薄膜仿真与设计 —— 数据科学层命令行入口",
    )
    parser.add_argument("--version", action="version", version=f"omo {__version__}")
    parser.add_argument("--info", action="store_true", help="显示项目信息")
    sub = parser.add_subparsers(dest="command")
    _build_optimize_parser(sub)

    args = parser.parse_args()

    if args.info:
        print(f"omo {__version__} —— OMO 纳米多层薄膜轻量化仿真与设计软件")
        print("子包：optics / electrical / emi / optimize / neural / benchmark / api")
        print("物理引擎（M1）与 NN 代理模型（M2.5）已实现；"
              "目标反推（M5 v1，omo-cli optimize）已可用。")
        return

    if args.command == "optimize":
        raise SystemExit(args.handler(args))
    parser.print_help()


if __name__ == "__main__":
    main()
