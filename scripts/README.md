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

`build-lite.ps1` 默认把**引擎源码目录**限制在 90MB、**轻量包**限制在 50MB（取自设计文档 §7），
目的是拦住 torch/fastapi/matplotlib 这类可选依赖偷偷进包。

> ⚠️ **一处待决的设计矛盾（T8 实测）**：轻量包要装 Electron 壳，而 Electron 运行时本身
> 约 110MB（压缩后）/ 250MB（解包），因此"轻量包 ≤50MB"在**内嵌 Electron 运行时**时不可能成立。
> 实测（2026-09）应用侧载荷：Go 后端 26.4MB + 渲染产物 0.61MB + 引擎源码 0.48MB ≈ 暂存 27.5MB / 压缩 13.9MB。
> 也就是说这个门禁要么**放宽**，要么轻量包**不带 Electron 运行时**——需在 T9/T11 前定夺。
> 门禁默认仍然生效（宁可拦住，也不要让体积悄悄膨胀），可用 `-LiteLimitMB` 临时覆盖。

## CI

`.github/workflows/ci.yml` 的 `packaging` job 会在 ubuntu + `pwsh` 上跑这三件事：

1. 用**桩壳目录**跑通 `build-lite.ps1` 全路径（暂存 → 门禁 → 压缩），退出码必须为 0；
2. 把门禁上限压到 1MB，验证它**真的会拦**（退出码 1）；
3. 在没装引擎的环境跑 `setup-engine.ps1 -SkipInstall`，验证它退出 1 且打印"What to check"指引
   —— 即 T8 验收项"无 Python 错误路径"。
