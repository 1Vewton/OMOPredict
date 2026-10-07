# server —— Go 中间层（M3 完成；M5 v2 增 optimize；M6-a 增单用户模式与 stdio RPC）

> **中文** · [English version](README.en.md)

用户管理（或单用户本地模式）/ 数据持久化 / 仿真任务编排，对外提供 REST API 与 stdio JSON-RPC。

## 结构（Go 标准布局）

```
server/
├── cmd/omopredict/        # 主程序入口（HTTP 服务；--stdio 走 stdio JSON-RPC；优雅退出）
├── .env.example           # 配置模板（复制为 .env；.env 已 gitignore）
└── internal/
    ├── api/               # REST 路由与中间件（健康检查、认证、任务、/api/meta）
    ├── mode/              # 运行模式解析（OMO_AUTH_MODE=jwt|none、OMO_ENGINE_TRANSPORT=http|stdio）
    ├── model/             # 数据模型（膜结构、仿真任务 kind=simulate|optimize、结果）—— snake_case JSON
    ├── rpc/               # stdio JSON-RPC 分发器（桌面形态）+ http↔rpc 契约一致性测试
    ├── store/             # 数据库层：GORM 打开（sqlite/mysql/postgres）+ 自动迁移 + .env 配置
    ├── store/storetest/   # 测试用内存 SQLite 助手（OpenMemory）
    ├── user/              # 用户注册/登录 + JWT（GORM store + bcrypt + JWT）
    └── task/              # 任务编排：生命周期 + 调用 Python 引擎（simulate|optimize 异步）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/version` | 服务版本（含 Go 版本） |
| GET | `/api/meta` | **能力端点**：`{version, auth_mode, auth_required, engine_transport}`（前端据此决定是否显示登录） |
| POST | `/api/auth/register` | 注册（username 3-32 位 [a-zA-Z0-9_]，密码 ≥8 位） |
| POST | `/api/auth/login` | 登录，返回 `{token, user}`（JWT HS256） |
| GET | `/api/auth/me` | 当前用户（需 `Authorization: Bearer <token>`） |
| POST | `/api/tasks` | 创建任务（**异步**执行，返回 202；`kind=simulate`（默认）\| `optimize`） |
| GET | `/api/tasks` | 列出当前用户任务（新建在前） |
| GET | `/api/tasks/{id}` | 查询任务状态与结果（仅本人，异步轮询） |
| DELETE | `/api/tasks/{id}` | 删除任务（含结果）；归属校验，不存在或非本人统一 404 |

> 完整的请求/响应示例、错误码与 curl 演示见 **`docs/api/rest.md`**；
> Go → Python 引擎契约见 **`docs/api/engine.md`**；
> 桌面形态的 stdio JSON-RPC 契约见 **`docs/api/rpc.md`**。
>
> `OMO_AUTH_MODE=none` 时认证中间件直接注入固定用户（`user_id="local"`），不读 `Authorization`；
> `auth.*` 接口在该模式下返回 401（stdio 传输固定为单用户模式）。

## 配置（.env 或环境变量）

配置写在 `server/.env`（模板见 `.env.example`，已 gitignore）或环境变量；
优先级：真实环境变量 > .env > 默认值。

| 变量 | 默认 | 说明 |
|---|---|---|
| `OMO_DB_DRIVER` | `sqlite` | 数据库驱动：`sqlite` \| `mysql` \| `postgres` |
| `OMO_DB_DSN` | `omopredict.db` | 连接串（各驱动格式见 `.env.example`） |
| `OMO_SERVER_ADDR` | `:8080` | 监听地址 |
| `OMO_JWT_SECRET` | 开发默认值（**生产必须设置**） | JWT 签名密钥 |
| `OMO_JWT_TTL` | `24h` | 令牌有效期（Go duration 格式） |
| `OMO_ENGINE_URL` | `http://127.0.0.1:8000` | Python 引擎地址（任务编排调用 `/simulate`、`/optimize`） |
| `OMO_AUTH_MODE` | `jwt` | 认证模式：`jwt`（Web，多用户）\| `none`（桌面，单用户 `user_id="local"`） |
| `OMO_ENGINE_TRANSPORT` | `http` | 引擎传输方式：`http`（Web，配合 `OMO_ENGINE_URL`）\| `stdio`（桌面，配合 `OMO_ENGINE_CMD`，**不监听端口**） |
| `OMO_ENGINE_CMD` | — | 桌面形态的引擎启动命令（支持引号包裹含空格的路径）；缺省按 D9 顺序自动发现 |
| `OMO_ENGINE_PROJECT` | — | 引擎工程目录（含 `pyproject.toml`），用于 `uv`/`python` 启动与子进程工作目录；缺省推断 `resources/engine` |
| `OMO_ENGINE_TIMEOUT` | `60s` | 单次引擎调用超时（Go duration）；大规模网格反推需调大（如 `10m`） |
| `OMO_LOG_DIR` | — | 日志目录（不设则输出 stderr，保持现有行为） |

> **引擎传输（`OMO_ENGINE_TRANSPORT`）**：
> - `http`（默认）：Go 调 `OMO_ENGINE_URL`（引擎以 `uvicorn omo.api` 启动）——Web/开发形态。
> - `stdio`：Go 作为父进程拉起引擎（`python -m omo.rpc` 或完整包 sidecar），走 stdio JSON-RPC 2.0，
>   **全程不监听任何端口**——桌面形态（docs/desktop.md D11/§10.6，已实测满足）。
>   启动命令按 `OMO_ENGINE_CMD` → `resources/engine/omo-rpc[.exe]` → `uv run --frozen --project <engine>` →
>   PATH `python`/`python3`/`py` 依次解析（`internal/task/engine_resolve.go`）；
>   **解析失败启动即退出并打印指引**，不会静默回退到 HTTP。
>   两种传输的请求/响应载荷**逐字段相同**（`Engine` 接口 + 共用 `simulateParams`），
>   并有"stdio↔HTTP 载荷逐字节一致"的测试守护。
>
> 以 `--stdio` 启动时**必须** `OMO_AUTH_MODE=none`，否则进程直接报错退出（不静默降级）；
> 该模式下 stdout 只允许 JSON-RPC 行，GORM 日志与引擎日志都走 stderr（有回归测试守护）。

存储基于 **GORM**（`gorm.io/gorm`）：SQLite 用纯 Go 驱动（`glebarez/sqlite`，兼容
CGO_ENABLED=0 环境），MySQL / PostgreSQL 切换 `OMO_DB_DRIVER` + DSN 即可，
表结构由 `store.Migrate` 自动迁移。

## 常用命令

```bash
cd server
go build ./...     # 编译
go test ./...      # 测试
go vet ./...       # 静态检查
go run ./cmd/omopredict   # 启动（默认 :8080，读取 .env）
```

> 中国大陆网络提示：Go 默认模块代理 proxy.golang.org 可能不通，
> 建议 `$env:GOPROXY = "https://goproxy.cn,direct"` 后拉取依赖。

### 测试速度约定（新增测试请沿用）

- **内存 SQLite**：测试统一用 `storetest.OpenMemory(t, models...)`（`internal/store/storetest`）——
  进程内私有内存库，无落盘、无文件锁，比临时文件库快约 24%（api 包 2.10s → 1.59s）。
  文件 DSN 的生产行为由 `internal/store` 自身测试保障（`TestOpenSQLiteAndMigrate`、`TestOpenMemorySQLite`）。
- **`t.Parallel()`**：互不共享状态的用例都加（本项目 59 处）。注意
  `t.Setenv` 与 `t.Parallel()` 互斥（会 panic）——`store` 包的配置解析用例因此保持串行。
- **bcrypt 成本**：测试用 `user.WithBcryptCost(bcrypt.MinCost)`（仍走完整哈希/校验路径，
  但把每次 ~60ms 降到 ~1ms）；生产保持 `bcrypt.DefaultCost`。
- **异步任务轮询**：`waitForTask` / `waitSucceeded` 立即首查 + 5ms 间隔（勿用固定 `sleep`）。
- **测量注意**：本沙箱下 `go test -v` 的输出经 PowerShell 管道捕获会显著放大耗时
  （曾误测出 api 包 9.6s，实际 1.9s）；测速请用 `go test ./... -count=1` 并计时墙钟。
  另注：每个测试二进制的启动在本沙箱约 0.2–0.3s（CI 上不存在），因此单包成绩会含这部分固定开销。

**参考成绩**（本机，热缓存）：全量 `go test ./... -count=1` ≈ 1.9–2.6s；
`go test ./internal/api ./internal/rpc -count=3`（真正执行 6 轮）仅 0.26s / 0.19s
——即测试执行本身已接近零成本，墙钟主要由编译与进程启动构成。

## 分层纪律（AGENTS.md §6.6）

- 本层**不含物理公式**：物理逻辑只在 Python 引擎（`engine/`）。本层通过 `Engine` 接口调用引擎，
  两种传输实现同一契约：HTTP → `omo.api`（FastAPI）、stdio → `omo.rpc`（桌面，不监听端口）；
- 前端只与本服务通信；JSON 字段 snake_case，与 Python 引擎契约一致；
- HTTP handler 与 RPC 分发器**共用同一服务层**（`task.CreateRequest`、`task.Service.GetOwned/DeleteOwned`），
  新增方法时须同步更新 `docs/api/` 与 `internal/rpc/contract_test.go`。

## 当前状态

- ✅ **M3**：健康检查 `/health`、`/version`、中间件（日志 + panic 兜底）；数据模型
  （FilmStack / SimulationTask / TaskResult）；用户系统（注册 / 登录 / JWT，GORM 兼容
  sqlite/mysql/postgres）；任务编排（`POST /api/tasks` 异步 → 调引擎 `/simulate` → 持久化），
  端到端冒烟通过（Go → uvicorn 引擎 → T/Rs/SE 回传）
- ✅ **M5 v2**：任务模型泛化 `kind=simulate|optimize` + `OptimizeSpec` 参数列 +
  `optimize_result`（引擎报告原样持久化，顶层注入 `task_id`）；`EngineClient.Optimize`
- ✅ **M6-a T1–T3**：单用户模式（`OMO_AUTH_MODE=none` + `GET /api/meta`）、
  `DELETE /api/tasks/{id}`、stdio JSON-RPC 分发器（`internal/rpc` + `omopredict --stdio`，
  错误码沿用 HTTP 语义，12 个 rpc 用例 + 5 个契约一致性用例）
- ✅ **M6-a T4.5**：Go→引擎 **stdio 传输**（`internal/task/engine_stdio.go` + `engine_resolve.go`）：
  `Engine` 接口统一 HTTP/stdio、`StdioEngine` 惰性子进程 + id 关联 + 超时 + 优雅关闭、
  D9 1–4 级引擎发现、`OMO_ENGINE_TRANSPORT/OMO_ENGINE_CMD/OMO_ENGINE_PROJECT/OMO_ENGINE_TIMEOUT`；
  12 个新用例（含真实子进程假引擎与载荷一致性）+ 端到端冒烟确认**无监听端口**
- ⏳ **待做**：`omo-cli simulate`；Host 层的 D9 第 5 级友好报错对话框与 D5 健康检查/重启限速（T6）
