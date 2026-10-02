# scripts —— 构建与运维脚本

> 设计见 [`docs/desktop.md`](../docs/desktop.md) §6/§7；T8 交付 `setup-engine.ps1` 与 `build-lite.ps1`，
> T9 交付 `build-desktop.ps1` 与 `rpc-cli.ps1`。

| 脚本 | 任务 | 作用 |
|---|---|---|
| `setup-engine.ps1` | T8 | 轻量包用户在**自己机器上**准备引擎：`uv sync --frozen`，否则 `python -m pip install -e engine`；随后发一次 `ping` 确认引擎可用 |
| `build-lite.ps1` | T8 | 组装轻量包：渲染产物 + Go 后端 + **引擎源码** + setup 脚本 + README → 体积门禁 → zip |
| `build-desktop.ps1` | T9 | 完整包：渲染产物 + Go 后端 + **PyInstaller 引擎 sidecar** + 壳 TS（main ESM / preload CJS）→ electron-builder → 体积门禁 |
| `rpc-cli.ps1` | T9 | 手工调试：向 stdio 端点发一行/多行 JSON-RPC，把 stderr 日志与响应分开打印 |
| `start-local.ps1` | T9 | 无壳调试（HTTP 模式 + 打开浏览器）—— **待做** |

## 用法

```powershell
# 轻量包用户：准备引擎（只需一次）
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1
powershell -ExecutionPolicy Bypass -File scripts\setup-engine.ps1 -SkipInstall    # 只验证引擎可用

# 轻量包（需要 electron-builder 产出的壳目录；-ShellDir 可指定）
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-lite.ps1 -AllowMissingShell  # 只暂存 + 门禁

# 完整包（内置引擎，用户无需装 Python；PyInstaller 约 1 分钟）
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1 -SkipPackaging    # 前四步 + 门禁

# 调试协议（不用开壳）
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method ping
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method tasks.list
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Target engine -Method ping
powershell -ExecutionPolicy Bypass -File scripts\rpc-cli.ps1 -Method no.such.method  # 看 -32601
```

退出码：`setup-engine` / `rpc-cli` = 0 成功 / 1 失败；`build-lite` / `build-desktop` =
0 出包 / 1 构建或门禁失败 / **2 仅暂存**（没做最后的打包步骤，不假装成功）。

> `rpc-cli.ps1` 默认把 SQLite 放在系统临时目录；受限环境（如本仓库的沙箱）用 `-DataDir <可写目录>`
> 指到工作区内，否则会撞上 HANDOVER §6.23 那个「`%TEMP%` 写不了 SQLite」的坑。

## ⚠️ 写 `.ps1` 的两条硬规矩（都踩过）

1. **注释一律 ASCII**。中文 Windows 上 PowerShell 5.1 按 GBK 读 `.ps1`，CJK 注释可能"吃掉"换行，
   把**下一行代码**注释掉，而且 `Parser::ParseFile` 报 0 个语法错误（见 HANDOVER §6.19）。
2. **`Join-Path` 只能给一个子路径**。`Join-Path $a 'b' 'c'` 需要 PS 6+ 的 `-AdditionalChildPath`；
   在 5.1 上会报 `A positional parameter cannot be found`。多段路径请写成 `Join-Path $a 'b/c'`
   （正斜杠在 Windows 也能用，顺带让脚本能在 Linux/macOS 上跑 —— CI 就是这么验的）。

另外读**中文文本文件**时要显式 `-Encoding UTF8`：PS 5.1 会把无 BOM 的 UTF-8 当 ANSI 解，
`ConvertFrom-Json` 会直接失败（见 HANDOVER §6.24）。

## 体积门禁

两道包脚本各自用同样的思路：**把"我们控制不了的大常量"和"我们会改坏的部分"分开管**。

`build-lite.ps1`（轻量包）：

| 门禁 | 默认上限 | 为什么是这个数 |
|---|---|---|
| **app payload** | **50MB** | 我们自己掌控的部分（Go 后端 + 渲染产物 + 引擎源码 + 脚本）。**这道才是防回归的主闸**：torch/fastapi/matplotlib 泄漏会让它直接爆掉（torch 单独就几百 MB）。实测 ~27.5MB |
| **lite zip** | **150MB** | payload + Electron 运行时。Electron 自身压缩后约 110MB，是个我们控制不了的常量 |
| 引擎源码目录 | 90MB | 拦住"把整个引擎环境打进包" |

`build-desktop.ps1`（完整包）：

| 门禁 | 默认上限 | 为什么是这个数 |
|---|---|---|
| **engine dir** | **250MB** | PyInstaller onedir 树。**实测 165.6MB**（numpy + scipy；torch/fastapi/uvicorn/matplotlib 均为 0 个条目）。原设计写 90MB，是按"预期 50–90MB"估的，实测偏大 |
| **app payload** | **50MB** | Go 后端 + 渲染产物 + 壳 JS（实测 27.1MB） |
| **distributable** | **300MB** | 真正发出去的 zip / nsis 安装包（不是解包后的目录） |

```powershell
# 需要时按需覆盖（改动前请先想清楚是哪种情况）
-PayloadLimitMB 80      # 渲染产物/后端确实长大了
-PackageLimitMB 200     # 换了 Electron 版本，体积变了
-EngineLimitMB 300      # 引擎确实加了依赖（但要先确认不是 torch 混进来）
```

> ✅ **已决（2026-09）**：轻量包**保留内嵌 Electron 运行时**，因此原设计里的"轻量包 ≤50MB"
> **放宽到 150MB**（Electron 压缩后约 110MB，该数字不可能压到 50MB 以下）；同时新增
> **app payload ≤50MB** 这道紧门禁盯住我们真正会改坏的部分（实测 27.5MB）。
> 完整包的 **engine dir 上限由 90MB 放宽到 250MB**——同样是实测结果：PyInstaller 打出的
> numpy+scipy onedir 是 **165.6MB**（已验证 4 个被排除的包 0 条目、且 sidecar 真能算对结果）。

## CI

`.github/workflows/ci.yml` 里：

- `desktop` job 跑 `pnpm build`（验证 main=ESM / preload=CJS 真的能产出）+ type-check + vitest；
- `packaging` job（ubuntu + `pwsh`）跑：
  1. 用**桩壳目录**跑通 `build-lite.ps1` 全路径（暂存 → 门禁 → 压缩），退出码必须为 0；
  2. 把门禁上限压到 1MB，验证它**真的会拦**（退出码 1）；
  3. 在没装引擎的环境跑 `setup-engine.ps1 -SkipInstall`，验证它退出 1 且打印"What to check"指引
     —— 即 T8 验收项"无 Python 错误路径"；
  4. 用刚构建出的后端跑 `rpc-cli.ps1` 的 `ping`（必须拿到 `"status":"ok"`）与未知方法
     （必须回 `-32601`）—— 调试工具也要有人验。
