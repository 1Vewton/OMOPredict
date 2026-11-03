# scripts —— 构建与运维脚本

> **中文** · [English version](README.en.md)

> 设计见 [`docs/desktop.md`](../docs/desktop.md) §6/§7；T8 交付 `setup-engine.ps1` 与 `build-lite.ps1`，
> T9 交付 `build-desktop.ps1`、`rpc-cli.ps1`、`start-local.ps1` 与 `release-manifest.ps1`，T11 交付 `smoke-desktop.ps1`。

| 脚本 | 任务 | 作用 |
|---|---|---|
| `setup-engine.ps1` | T8 | 轻量包用户在**自己机器上**准备引擎：`uv sync --frozen`，否则 `python -m pip install -e engine`；随后发一次 `ping` 确认引擎可用 |
| `build-lite.ps1` | T8 | 组装轻量包：渲染产物 + Go 后端 + **引擎源码** + setup 脚本 + README → 体积门禁 → zip |
| `build-desktop.ps1` | T9 | 完整包：渲染产物 + Go 后端 + **PyInstaller 引擎 sidecar** + 壳 TS（main ESM / preload CJS）→ electron-builder（**`zip` 必需 / `nsis` best-effort**）→ 体积门禁 |
| `rpc-cli.ps1` | T9 | 手工调试：向 stdio 端点发一行/多行 JSON-RPC，把 stderr 日志与响应分开打印 |
| `start-local.ps1` | T9 | **无壳本地调试**：拉起 `local-bridge.mjs`（HTTP ↔ Go `--stdio` ↔ 引擎），托管渲染产物并打印/打开浏览器地址；`-QuitAfterReady` 可当冒烟测试（起栈→真跑一次任务验证引擎→收栈） |
| `release-manifest.ps1` | T9 | 发布清单：给产物生成 `SHA256SUMS.txt` + JSON 清单；`-Verify` 反查校验（篡改必失败） |
| `smoke-desktop.ps1` | T11 | **一键判定壳能不能跑**：构建齐（渲染/后端/壳 TS）→ 启动 Electron → 渲染成功退出 **0**、失败退出 **1** 并打印原因；开头会自检是不是跑在 harness 里 |
| `diagnose-electron.ps1` | T11 | Electron 启动诊断：打印"我在哪跑"（`ELECTRON_RUN_AS_NODE`/DSH 变量/父进程）+ 最小 Electron 程序的启动矩阵，用来区分"在沙箱内"与"机器本身起不来" |

`scripts/` 根目录下还有脚本用到的 Node 模块（目前只有本地调试桥）：

| 文件 | 作用 |
|---|---|
| `local-bridge-lib.mjs` | 桥的**可单测核心**：REST↔RPC 路由映射、JSON-Lines 客户端、静态托管与目录穿越防护（零依赖） |
| `local-bridge-lib.d.mts` | 上面那个 `.mjs` 的类型声明（`desktop/src/shell/localBridge.test.ts` 会 import 它） |
| `local-bridge.mjs` | 桥的 CLI 入口：拉起 Go `--stdio`、监听唯一端口、把渲染产物托管出去 |

> 为什么这两个 `.mjs` 不放在 `lib/` 子目录：仓库根 `.gitignore` 第 17 行有一条**通配的 `lib/`**
> （Python 模板继承来的），放进去会**被静默忽略**——文件在本地存在、`git status` 里却看不见。

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

# 无壳本地调试：在浏览器里用完整无端口链路（Ctrl+C 退出即全部回收）
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -Port 9000 -Open
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -SkipFrontendBuild -SkipGoBuild
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -EngineCmd '"C:\Python312\python.exe" -m omo.rpc'

# 把它当冒烟测试：起栈 → 真跑一次最小任务验证引擎 → 收栈退出（0/1）
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -QuitAfterReady
# stdin 被重定向时（CI / 管道 / 计划任务）**自动**走这个就绪门模式，不会挂住；
# 若要强制保持服务（即使在重定向下）加 -KeepRunning。

# 发布清单（tag 发的版本；也可本地手工给完整包补清单）
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -InputDir desktop\release -OutDir dist\release
powershell -ExecutionPolicy Bypass -File scripts\release-manifest.ps1 -Verify    # 校验已发布的清单

# 壳冒烟自检（必须在 DSH 沙箱**外**的普通终端里跑，见下）
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts\smoke-desktop.ps1 -SkipBuild   # 用已有产物，快
```

退出码：`setup-engine` / `rpc-cli` / `smoke-desktop` / `start-local` / `release-manifest` = 0 成功 / 1 失败；
`build-lite` / `build-desktop` = 0 出包 / 1 构建或门禁失败 / **2 仅暂存**（没做最后的打包步骤，不假装成功）。

## `start-local.ps1` 与 `local-bridge.mjs`（无壳调试）

桌面形态**运行期不监听任何端口**（`docs/desktop.md` D11）：Go 以 `--stdio` 跑，引擎又是 Go 的
stdio 子进程。安全，但浏览器也就无从连起。`local-bridge.mjs` 就是补上这一环的适配器：

```
浏览器 --HTTP--> local-bridge.mjs --stdio JSON-RPC--> Go --stdio JSON-RPC--> Python 引擎
```

整棵进程树里**只有桥监听一个回环端口**，所以这条路径同时验证了"无端口链路"与"UI 能不能用"，
不需要构建或启动 Electron。桥的定位是**调试工具**：只跟自己拉起的子进程说话、默认绑 `127.0.0.1`，
路由表是**封闭白名单**（没有任何通用转发/代理功能）。

实测（本机）：`/health`、`/api/meta`（`auth_mode: none`）、建 `simulate` 任务 → `Rs = 3.970819 Ω/sq`、
`T@550nm = 0.974497`、`SE@10GHz = 33.7036`（与 REST/引擎契约一致）、SPA 深链回退、删除任务均正常；
Ctrl+C 后端口释放、无残留子进程。

### 退出与就绪门（`-QuitAfterReady` / `-KeepRunning`）

| 场景 | 行为 |
|---|---|
| 交互终端 | 服务到 Ctrl+C（原行为） |
| stdin 被重定向（CI / 管道 / 计划任务） | **以就绪为成功信号**：校验通过即退出 0，不再无限等待 |
| `-QuitAfterReady` | 强制就绪门（在终端里也能用） |
| `-KeepRunning` | 强制保持服务（即使 stdin 被重定向） |

退出码：就绪门通过 0；启动失败或就绪门失败 1（并打印引擎真实错误 + "What to check"）。

> ⚠️ **就绪门不只查 `/health`**：`/health` 对应 RPC `ping`，是 **Go 自己**应答的，而引擎是
> **惰性拉起**的——引擎完全坏掉时 `/health` 照样 200。所以就绪门会**真跑一次最小任务**
> （ITO/Ag/ITO 40-10-40 的 simulate），轮询到 `succeeded` 才算通过（HANDOVER §6.43）。
> 实测：正常 3.8 s 退出 0 并打印 `engine answered (Rs=3.9708…)`；引擎路径写错时 3.6 s 退出 1，
> 报出 `fork/exec C:\nope\python.exe: The system cannot find the path specified`。

> ⚠️ 桥会在**自己的环境里**设 `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` 再拉起 Go（权威设定其实在
> Go 拉起引擎处，这里是防御性重复），否则引擎的 UTF-8 日志落进日志文件就是乱码，
> 而紧挨着的 Go 日志却正常（HANDOVER §6.37）。

## `release-manifest.ps1`（发布清单）

产出两份东西（`-OutDir`，默认 `dist/release/`）：

| 文件 | 内容 |
|---|---|
| `SHA256SUMS.txt` | `sha256sum` 兼容格式 `<64 hex>  <文件名>`（两个空格分隔）；**UTF-8 无 BOM + 仅 LF**，可在 Linux/macOS 上直接 `sha256sum -c` |
| `omopredict-<version>.json` | 机器可读清单：`product` / `version` / `commit` / `generated` / 每个产物的 `sha256`、`size` |

- 只收 `-InputDir` 的**直接子文件**，且扩展名必须在 `-Extensions`（可发布件白名单：
  `.zip/.exe/.msi/.dmg/.pkg/.AppImage/.deb/.rpm/.tar.gz`）。这样 electron-builder 的记账文件
  （`builder-debug.yml`、`builder-effective-config.yaml`、`*.blockmap`）不会混进清单，
  将来出现新的垃圾文件也不会像黑名单那样"悄悄漏进来"。
- 清单外的产物用 `-Include <路径或通配符>` 显式加入（release 里轻量 zip 在另一个目录，就是这么带进来的）；
  `-Verify` 要传**同样的 `-Include`** 才能找到它们。
- 版本取 `desktop/package.json`（拿不到再退到 `engine/pyproject.toml`），也可 `-Version` 覆盖。
- `-Verify` 逐条比对：缺文件或哈希不符都算失败（退出 1），**篡改必然被发现**（已实测）。
- 发布 job 在打清单前会先校验 `tag`（去掉 `v`）与 `desktop/package.json` 的 `version` 一致，
  避免发出"标着 vX 却装着 Y"的包。


> `smoke-desktop.ps1` 是 T11 的判定工具：渲染成功打印 `[smoke] OK` 并退出 0，否则打印原因退出 1
> （会识别原生崩溃码并提示是不是跑在沙箱里）。它做的正是 docs/desktop.md §10 里那几件"必须真的启动一次"的事。
> ⚠️ **沙箱内必然失败**：DSH 沙箱里 Electron 的浏览器进程起不来（HANDOVER §6.31 有完整证据），
> 所以这个脚本要在**沙箱外的普通 PowerShell 窗口**里跑；在沙箱内跑会看到 `0x80000003` 原生崩溃。

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

- `desktop` job 跑 `pnpm build`（验证 main=ESM / preload=CJS 真的能产出）+ type-check + vitest
  （含 `desktop/src/shell/localBridge.test.ts`：覆盖调试桥的路由映射、JSON-Lines 客户端与穿越防护）；
- `packaging` job（ubuntu + `pwsh`）跑：
  1. 用**桩壳目录**跑通 `build-lite.ps1` 全路径（暂存 → 门禁 → 压缩），退出码必须为 0；
  2. 把门禁上限压到 1MB，验证它**真的会拦**（退出码 1）；
  3. 在没装引擎的环境跑 `setup-engine.ps1 -SkipInstall`，验证它退出 1 且打印"What to check"指引
     —— 即 T8 验收项"无 Python 错误路径"；
  4. 用刚构建出的后端跑 `rpc-cli.ps1` 的 `ping`（必须拿到 `"status":"ok"`）与未知方法
     （必须回 `-32601`）—— 调试工具也要有人验；
  5. 把 `start-local.ps1` 复制进一个空目录，证明它的失败路径是可操作的（退出 1 + "What to check"），
     且不需要 pnpm / Go / Electron；
  6. 往返验证 `release-manifest.ps1`：生成 → `-Verify` 必须通过 → 篡改一个字节 → `-Verify` 必须失败。
     没人跑过的门禁等于没有门禁。
- `release` job **只由 `v*` tag 触发**（`if: startsWith(github.ref, 'refs/tags/v')`），**跑在 `windows-latest`**：
  1. tag 与 `desktop/package.json` 的 `version` 不一致就直接失败；
  2. `build-desktop.ps1` 真打**完整包**（electron-builder 的 nsis/zip 要 Windows 目标；PyInstaller 不能交叉编译）；
  3. `build-lite.ps1` 用**刚打出的真实壳**（`desktop/release/win-unpacked`，用 `-ShellDir` 显式指定）
     再出轻量包；
  4. 生成 SHA256 清单（轻量 zip 用 `-Include` 带进来），**并在发布前用清单校验自己**；
  5. `gh release create` 上传完整包 + 轻量包 + 清单。

> ⚠️ **这个 job 必须在 Windows 上跑**：脚本里的 `go build` 不设 GOOS（产物是宿主机格式），
> 而"桩壳 + Linux 二进制"打出来的 `-win-x64.zip` 在任何机器上都跑不起来（HANDOVER §6.41）。
> macOS / Linux 发布不在当前范围：`desktop/package.json` 只配了 `win` 目标，且 mac 需要签名与公证；
> 真要做应当是**每个平台各自一个原生 job**（引擎 sidecar 无法跨平台复用）。
> **教训**：桩壳只能验证脚本语法与体积门禁，**验证不了目录结构是否可运行**。
> 轻量包曾经因此把壳整个塞进 `win-unpacked/` 子目录（zip 里出现两个 `resources/`），
> 现在 `build-lite.ps1` 有**结构断言**（`OMOPredict.exe` 必须在包根、`resources/{dist,engine,omopredict-server.exe}` 必须齐）。


