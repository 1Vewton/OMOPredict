# omo.cli —— command-line entry point (omo-cli)

> **English** · [中文版](README.md)

## Responsibility

Scripted simulation and benchmarking: run simulations and generate benchmarking reports in batches without a frontend.

## Currently available commands

```bash
uv run omo-cli --version   # show version
uv run omo-cli --info      # show project information
```

## Planned commands (landing with the milestones)

```bash
uv run omo-cli simulate --stack ito/ag/ito --thickness 40 10 40   # M1: single simulation
uv run omo-cli benchmark --dataset docs/benchmarks/xxx.json       # M2: literature benchmarking
uv run omo-cli optimize --target "T>=0.85, Rs<=10"                # M5: parameter optimization
```

## Notes

- Entry function: `omo.cli.main:main` (already registered as `omo-cli` in `pyproject.toml`'s `[project.scripts]`)
- All subcommands must share the same set of physics-engine calls as `omo.api`, without copying logic
