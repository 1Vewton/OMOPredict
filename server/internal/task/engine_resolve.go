// 引擎发现与启动命令解析（stdio 传输，桌面形态）。
//
// 对应 docs/desktop.md D9 的五级解析顺序：环境变量 → 完整包 sidecar → uv → python → 报错。
// 解析逻辑写成"可注入环境"的纯函数，便于单测覆盖各级而不触碰真实机器。
package task

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ErrEngineNotFound 五级发现全部失败（调用方应给出可操作的指引，Host 层负责友好对话框）。
var ErrEngineNotFound = errors.New("engine: 未找到可用的引擎启动方式")

// EngineCommand 引擎启动命令（stdio 传输）。
type EngineCommand struct {
	// Argv 启动参数，Argv[0] 为可执行文件。
	Argv []string
	// Dir 工作目录（空 = 继承父进程）。
	Dir string
	// Source 解析来源，用于日志与诊断（如 "OMO_ENGINE_CMD"）。
	Source string
	// Env 追加到父进程环境之上的额外变量（nil = 仅继承父进程环境）。
	// Host 可用它向引擎注入形态相关配置（如日志目录）；测试也用它选择假引擎行为。
	Env []string
}

// String 便于日志输出（含来源与工作目录，排障时能看出用的是哪一级）。
func (c EngineCommand) String() string {
	desc := strings.Join(c.Argv, " ")
	if c.Dir != "" {
		return fmt.Sprintf("%s（cwd=%s；来源 %s）", desc, c.Dir, c.Source)
	}
	return fmt.Sprintf("%s（来源 %s）", desc, c.Source)
}

// ResolveEnv 解析所需的环境访问器（可注入，便于测试）。
type ResolveEnv struct {
	Getenv   func(string) string
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	// ExeDir 本进程可执行文件所在目录：用于定位完整包的 resources/engine。
	ExeDir string
}

// DefaultResolveEnv 从真实进程环境构造 ResolveEnv。
func DefaultResolveEnv() ResolveEnv {
	dir := ""
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	return ResolveEnv{
		Getenv:   os.Getenv,
		LookPath: exec.LookPath,
		Stat:     os.Stat,
		ExeDir:   dir,
	}
}

// ResolveEngineCommand 按 docs/desktop.md D9 的顺序解析引擎启动命令：
//
//  1. `OMO_ENGINE_CMD`：直接执行（机房统一配置 / 高级用户）
//  2. 同级 `resources/engine/omo-rpc[.exe]`：完整包布局的 sidecar
//  3. PATH 有 `uv` 且存在引擎工程 → `uv run --frozen --project <engine> python -m omo.rpc`
//  4. PATH 有 `python`/`python3`/`py` → `<python> -m omo.rpc`
//  5. 均失败 → ErrEngineNotFound（附"装什么"的指引）
//
// 引擎工程目录取自 `OMO_ENGINE_PROJECT`，否则推断为 `<ExeDir>/resources/engine`
// 或其父目录同名位置（须含 `pyproject.toml` 才算有效）；该目录同时作为子进程工作目录，
// 使 `python -m omo.rpc` 能在 src 布局下正确导入 `omo`。
func ResolveEngineCommand(env ResolveEnv) (EngineCommand, error) {
	// 1) 显式命令优先级最高
	if raw := strings.TrimSpace(env.Getenv("OMO_ENGINE_CMD")); raw != "" {
		argv, err := splitCommandLine(raw)
		if err != nil {
			return EngineCommand{}, fmt.Errorf("engine: 解析 OMO_ENGINE_CMD %q: %w", raw, err)
		}
		if len(argv) == 0 {
			return EngineCommand{}, errors.New("engine: OMO_ENGINE_CMD 为空")
		}
		return EngineCommand{Argv: argv, Source: "OMO_ENGINE_CMD"}, nil
	}

	project := engineProjectDir(env)

	// 2) 完整包 sidecar（自带引擎，无需用户装 Python）
	if sidecar := findSidecar(env); sidecar != "" {
		return EngineCommand{
			Argv:   []string{sidecar},
			Dir:    project,
			Source: "resources/engine sidecar",
		}, nil
	}

	// 3) uv + 引擎工程（--frozen 保证按 lock 复现）
	if project != "" {
		if uv, err := env.LookPath("uv"); err == nil {
			return EngineCommand{
				Argv:   []string{uv, "run", "--frozen", "--project", project, "python", "-m", "omo.rpc"},
				Dir:    project,
				Source: "uv + 引擎工程目录",
			}, nil
		}
	}

	// 4) 系统 Python（需已安装 omo：见轻量包 setup-engine.ps1）
	for _, name := range []string{"python", "python3", "py"} {
		if exe, err := env.LookPath(name); err == nil {
			return EngineCommand{
				Argv:   []string{exe, "-m", "omo.rpc"},
				Dir:    project,
				Source: fmt.Sprintf("PATH 上的 %s", name),
			}, nil
		}
	}

	// 5) 全部失败：给出可执行的补救指引
	return EngineCommand{}, fmt.Errorf(
		"%w：请设置 OMO_ENGINE_CMD 指定引擎命令，或安装 uv（推荐）/ Python ≥3.12，"+
			"或使用含 resources/engine/omo-rpc 的完整包（当前 ExeDir=%q，引擎工程=%q）",
		ErrEngineNotFound, env.ExeDir, project)
}

// engineProjectDir 返回引擎工程目录（须含 pyproject.toml）；找不到返回空串。
func engineProjectDir(env ResolveEnv) string {
	if p := strings.TrimSpace(env.Getenv("OMO_ENGINE_PROJECT")); p != "" {
		if isEngineProject(env, p) {
			return filepath.Clean(p)
		}
	}
	if env.ExeDir == "" {
		return ""
	}
	for _, rel := range []string{
		filepath.Join("resources", "engine"),       // 安装目录内
		filepath.Join("..", "resources", "engine"), // 可执行文件位于子目录时的兜底
	} {
		p := filepath.Clean(filepath.Join(env.ExeDir, rel))
		if isEngineProject(env, p) {
			return p
		}
	}
	return ""
}

// isEngineProject 判断目录是否为引擎工程（以 pyproject.toml 为标志）。
func isEngineProject(env ResolveEnv, dir string) bool {
	info, err := env.Stat(filepath.Join(dir, "pyproject.toml"))
	return err == nil && !info.IsDir()
}

// findSidecar 查找完整包内的引擎 sidecar（omo-rpc / omo-rpc.exe）。
func findSidecar(env ResolveEnv) string {
	if env.ExeDir == "" {
		return ""
	}
	names := []string{"omo-rpc"}
	if runtime.GOOS == "windows" {
		names = []string{"omo-rpc.exe", "omo-rpc"}
	}
	for _, rel := range []string{
		filepath.Join("resources", "engine"),
		filepath.Join("..", "resources", "engine"),
	} {
		for _, name := range names {
			p := filepath.Clean(filepath.Join(env.ExeDir, rel, name))
			if info, err := env.Stat(p); err == nil && !info.IsDir() {
				return p
			}
		}
	}
	return ""
}

// splitCommandLine 按 shell 风格切分命令串，支持双引号包裹含空格的路径。
//
// 只处理双引号与 `\"` 转义：足够覆盖 OMO_ENGINE_CMD 的实际用法（如
// `"C:\Program Files\Python312\python.exe" -m omo.rpc`），
// 不做完整 shell 解析以免引入平台相关的意外语义（不展开变量、不处理单引号）。
func splitCommandLine(s string) ([]string, error) {
	var (
		out     []string
		cur     strings.Builder
		inQuote bool
		started bool
	)
	for i := 0; i < len(s); i++ {
		switch ch := s[i]; {
		case ch == '\\' && i+1 < len(s) && s[i+1] == '"':
			cur.WriteByte('"')
			i++
			started = true
		case ch == '"':
			inQuote = !inQuote
			started = true
		case (ch == ' ' || ch == '\t') && !inQuote:
			if started {
				out = append(out, cur.String())
				cur.Reset()
				started = false
			}
		default:
			cur.WriteByte(ch)
			started = true
		}
	}
	if inQuote {
		return nil, errors.New("引号未闭合")
	}
	if started {
		out = append(out, cur.String())
	}
	return out, nil
}
