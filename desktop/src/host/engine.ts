// 引擎发现（docs/desktop.md D9）与失败指引。
//
// **分工说明（重要）**：D9 的 1–4 级解析（OMO_ENGINE_CMD → 完整包 sidecar → uv → python）
// **已在 Go 侧实现**（`server/internal/task/engine_resolve.go`），因为真正拉起引擎子进程的是 Go。
// Host 只做两件事，避免把四级解析在 TS 里再抄一遍导致两边漂移：
//
//   1. **注入它才知道的信息**：随包分发的引擎 sidecar / 引擎工程目录（Go 看不到壳的资源目录，
//      只能靠自己的 ExeDir 推断）；
//   2. **D9 第 5 级**：解析全部失败时，给出面向用户的友好指引（真正的对话框在 T7）。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 引擎解析结果：要注入给 Go 的环境变量 + 诊断信息。 */
export interface EngineDiscovery {
  /** 注入给 Go 的引擎相关环境变量（可能为空 = 交给 Go 自动发现） */
  env: Record<string, string>
  /** 解析来源（写日志/诊断） */
  source: string
  /** 随包分发的引擎可执行文件（若存在） */
  sidecarPath?: string
  /** 引擎工程目录（含 pyproject.toml，若存在） */
  projectDir?: string
}

/** 探测输入（可注入，便于单测四级分支）。 */
export interface EngineProbeInput {
  /** 壳的资源目录（安装包内 `resources/`；开发期为仓库根） */
  resourcesDir?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

/** 引擎工程目录名（完整包/轻量包均为 `resources/engine`）。 */
const ENGINE_SUBDIR = 'engine'

/**
 * 探测引擎来源，返回要注入 Go 的环境变量。
 *
 * | 情形 | 注入 | source |
 * |---|---|---|
 * | 用户/机房已配置 `OMO_ENGINE_CMD` | 原样透传 | `env` |
 * | 资源目录内有 sidecar 可执行文件 | `OMO_ENGINE_CMD` 指向它（含空格时加引号） | `bundled-sidecar` |
 * | 资源目录内有引擎工程（pyproject.toml） | `OMO_ENGINE_PROJECT` | `bundled-project` |
 * | 都没有 | 不注入，交给 Go 的 1–4 级自动发现 | `auto` |
 */
export function discoverEngine(input: EngineProbeInput = {}): EngineDiscovery {
  const env = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const platform = input.platform ?? process.platform

  const explicit = env.OMO_ENGINE_CMD?.trim()
  if (explicit && explicit.length > 0) {
    return { env: { OMO_ENGINE_CMD: explicit }, source: 'env' }
  }

  const resourcesDir = input.resourcesDir?.trim()
  if (!resourcesDir) {
    return { env: {}, source: 'auto' }
  }
  const engineDir = join(resourcesDir, ENGINE_SUBDIR)
  const names = platform === 'win32' ? ['omo-rpc.exe', 'omo-rpc'] : ['omo-rpc']
  const sidecar = names.map((n) => join(engineDir, n)).find((p) => exists(p))
  const hasProject = exists(join(engineDir, 'pyproject.toml'))

  if (sidecar) {
    return {
      env: {
        OMO_ENGINE_CMD: quoteIfNeeded(sidecar),
        ...(hasProject ? { OMO_ENGINE_PROJECT: engineDir } : {}),
      },
      source: 'bundled-sidecar',
      sidecarPath: sidecar,
      ...(hasProject ? { projectDir: engineDir } : {}),
    }
  }
  if (hasProject) {
    return {
      env: { OMO_ENGINE_PROJECT: engineDir },
      source: 'bundled-project',
      projectDir: engineDir,
    }
  }
  return { env: {}, source: 'auto' }
}

/** 含空格/制表符的路径用双引号包裹（Go 侧 splitCommandLine 支持引号）。 */
export function quoteIfNeeded(path: string): string {
  return /[\s"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path
}

/**
 * D9 第 5 级的指引文本：告诉用户缺什么、装什么。
 *
 * 真正的"友好错误对话框"由 T7 的 Electron 壳用它渲染。
 */
export function engineSetupGuidance(platform: NodeJS.Platform = process.platform): string {
  // 只承诺真实存在的入口：目前只随包发了 scripts/setup-engine.ps1，
  // 非 Windows 直接给等价的手工命令（同样是 uv sync / pip install -e），不要指向不存在的 .sh。
  const installHint =
    platform === 'win32'
      ? '请任选其一：\n  1) 使用「完整包」（已内置引擎，无需另装 Python）；\n  2) 安装 uv（推荐，https://docs.astral.sh/uv/）后运行 scripts/setup-engine.ps1；\n  3) 安装 Python 3.12+ 后运行 scripts/setup-engine.ps1。'
      : '请任选其一：\n  1) 使用内置引擎的完整包；\n  2) 安装 uv（推荐，https://docs.astral.sh/uv/）后在 engine 目录运行 `uv sync`；\n  3) 安装 Python 3.12+ 后运行 `python -m pip install -e engine`。'
  return `未找到可用的仿真引擎，应用无法开始计算。\n\n${installHint}\n\n高级用法：设置环境变量 OMO_ENGINE_CMD 指向引擎启动命令（如 "python -m omo.rpc"）。`
}

/**
 * 把后端启动失败时的 stderr 尾部拼成可直接展示给用户的说明。
 *
 * Go 侧在解析失败时会打印可操作的指引（见 `engine_resolve.go`），因此这里优先展示它，
 * 再附上通用指引——用户看到的应该是"装什么"，而不是一句 exit code。
 *
 * `platform` 可显式传入：这不仅方便单测，也让"在 Windows 上生成给 Linux 用户的说明"
 * 这类场景成为可能（指引文本里的脚本名随平台不同）。
 */
export function describeEngineFailure(
  stderrTail: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const tail = stderrTail.trim()
  const engineLine = tail
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.includes('engine:') || l.includes('引擎'))
  if (engineLine) {
    return `${engineLine.trim()}\n\n${engineSetupGuidance(platform)}`
  }
  return `${engineSetupGuidance(platform)}\n\n后端输出（尾部）：\n${tail || '（无）'}`
}
