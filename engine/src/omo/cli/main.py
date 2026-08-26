"""omo-cli —— 命令行入口。

用法示例：
    omo-cli --version
    omo-cli --info

M1 之后将增加仿真子命令，例如：
    omo-cli simulate --stack ito/ag/ito --thickness 40 10 40
    omo-cli benchmark --dataset docs/benchmarks/xxx.json
"""

from __future__ import annotations

import argparse

from omo import __version__


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="omo-cli",
        description="OMO 纳米多层薄膜仿真与设计 —— 数据科学层命令行入口",
    )
    parser.add_argument("--version", action="version", version=f"omo {__version__}")
    parser.add_argument("--info", action="store_true", help="显示项目信息")
    args = parser.parse_args()

    if args.info:
        print(f"omo {__version__} —— OMO 纳米多层薄膜轻量化仿真与设计软件")
        print("子包：optics / electrical / emi / optimize / neural / benchmark")
        print("物理引擎（M1）与 NN 代理模型（M2.5）开发中。")


if __name__ == "__main__":
    main()
