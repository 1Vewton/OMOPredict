# omo.cli —— 命令行入口（omo-cli）

## 职责

脚本化仿真与对标：无需前端即可批量跑仿真、生成对标报告。

## 当前可用命令

```bash
uv run omo-cli --version   # 显示版本
uv run omo-cli --info      # 显示项目信息
```

## 计划命令（随里程碑落地）

```bash
uv run omo-cli simulate --stack ito/ag/ito --thickness 40 10 40   # M1：单次仿真
uv run omo-cli benchmark --dataset docs/benchmarks/xxx.json       # M2：文献对标
uv run omo-cli optimize --target "T>=0.85, Rs<=10"                # M5：参数优化
```

## 说明

- 入口函数：`omo.cli.main:main`（已在 `pyproject.toml` 的 `[project.scripts]` 注册为 `omo-cli`）
- 所有子命令必须与 `omo.api` 共享同一套物理引擎调用，不复制逻辑
