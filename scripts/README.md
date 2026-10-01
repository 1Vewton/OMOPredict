# scripts —— 构建与运维脚本

> 设计见 [`docs/desktop.md`](../docs/desktop.md) §6/§7；T8 交付 `setup-engine.ps1` 与 `build-lite.ps1`。

| 脚本 | 任务 | 作用 |
|---|---|---|
| `setup-engine.ps1` | T8 | 轻量包用户在**自己机器上**准备引擎：`uv sync --frozen`，否则 `python -m pip install -e engine`；随后发一次 `ping` 确认引擎可用 |
| `build-lite.ps1` | T8 | 组装轻量包：渲染产物 + Go 后端 + **引擎源码** + setup 脚本 + README → 体积门禁 → zip |
| `build-desktop.ps1` | T9 | 完整包（PyInstaller onedir 引擎 + electron-builder）—— **待做** |
| `rpc-cli.ps1` | T9 | 手工调试：向 stdio 发一行 JSON 看响应 —— **待做** |

## 用法

```powershell
# 轻量包用户：准备引擎（只需一次）
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1

# 只想验证引擎是否就绪（不装依赖）
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -SkipInstall

# 打包轻量包（需要先有 electron-builder 产出的壳目录）
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1 -ShellDir desktop\release\win-unpacked

# 没有壳时只做暂存 + 体积门禁（退出码 2 表示"未产出可运行包"）
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1 -AllowMissingShell
```

退出码：`setup-engine.ps1` = 0 就绪 / 1 失败；`build-lite.ps1` = 0 出包 / 1 构建或门禁失败 / **2 仅暂存**。

## ⚠️ 写 `.ps1` 的两条硬规矩（都踩过）

1. **注释一律 ASCII**。中文 Windows 上 PowerShell 5.1 按 GBK 读 `.ps1`，CJK 注释可能"吃掉"换行，
   把**下一行代码**注释掉，而且 `Parser::ParseFile` 报 0 个语法错误（见 HANDOVER §6.19）。
2. **`Join-Path` 只能给一个子路径**。`Join-Path $a 'b' 'c'` 需要 PS 6+ 的 `-AdditionalChildPath`；
   在 5.1 上会报 `A positional parameter cannot be found`。多段路径请写成 `Join-Path $a 'b/c'`
   （正斜杠在 Windows 也能用，顺带让脚本能在 Linux/macOS 上跑 —— CI 就是这么验的）。

另外读**中文文本文件**时要显式 `-Encoding UTF8`：PS 5.1 会把无 BOM 的 UTF-8 当 ANSI 解，
`ConvertFrom-Json` 会直接失败（见 HANDOVER §6.24）。

## 体积门禁

`build-lite.ps1` 有三道门禁，各有明确分工：

| 门禁 | 默认上限 | 为什么是这个数 |
|---|---|---|
| **app payload** | **50MB** | 我们自己掌控的部分（Go 后端 + 渲染产物 + 引擎源码 + 脚本）。**这道才是防回归的主闸**：torch/fastapi/matplotlib 泄漏会让它直接爆掉（torch 单独就几百 MB）。实测 ~27.5MB |
| **lite zip** | **150MB** | payload + Electron 运行时。Electron 自身压缩后约 110MB，是个我们控制不了的常量 |
| 引擎源码目录 | 90MB | 拦住"把整个引擎环境打进包" |

```powershell
# 需要时按需覆盖（改动前请先想清楚是哪种情况）
-... -PayloadLimitMB 80      # 渲染产物/后端确实长大了
-... -PackageLimitMB 200     # 换了 Electron 版本，体积变了
```

> ✅ **已决（2026-09）：轻量包保留内嵌 Electron 运行时**，因此把原设计文档里的"轻量包 ≤50MB"
> **放宽到 150MB**。原数字在"内嵌 Electron"前提下不可能成立（Electron 压缩后约 110MB / 解包约 250MB）。
> 为了不丢掉"防可选依赖泄漏"的作用，同时新增了 **app payload ≤50MB** 这道紧门禁——
> 它盯的正是我们会改坏的那部分（实测 27.5MB），而 Electron 那 ~110MB 常量不参与。
> 实测应用侧载荷：Go 后端 26.4MB + 渲染产物 0.61MB + 引擎源码 0.48MB。

## CI

`.github/workflows/ci.yml` 的 `packaging` job 会在 ubuntu + `pwsh` 上跑这三件事：

1. 用**桩壳目录**跑通 `build-lite.ps1` 全路径（暂存 → 门禁 → 压缩），退出码必须为 0；
2. 把门禁上限压到 1MB，验证它**真的会拦**（退出码 1）；
3. 在没装引擎的环境跑 `setup-engine.ps1 -SkipInstall`，验证它退出 1 且打印"What to check"指引
   —— 即 T8 验收项"无 Python 错误路径"。
