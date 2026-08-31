# server —— Go 中间层（M3）

用户管理 / 数据持久化 / 仿真任务编排，对外提供 REST API。

## 结构（Go 标准布局）

```
server/
├── cmd/omopredict/        # 主程序入口（HTTP 服务，优雅退出）
├── .env.example           # 配置模板（复制为 .env；.env 已 gitignore）
└── internal/
    ├── api/               # REST 路由与中间件（健康检查、认证接口）
    ├── model/             # 数据模型（膜结构、仿真任务、结果）—— snake_case JSON
    ├── store/             # 数据库层：GORM 打开（sqlite/mysql/postgres）+ 自动迁移 + .env 配置
    ├── user/              # 用户注册/登录 + JWT（GORM store + bcrypt + JWT）
    └── task/              # 仿真任务编排：生命周期 + 调用 Python 引擎（实现中）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/auth/register` | 注册（username 3-32 位 [a-zA-Z0-9_]，密码 ≥8 位） |
| POST | `/api/auth/login` | 登录，返回 `{token, user}`（JWT HS256） |
| GET | `/api/auth/me` | 当前用户（需 `Authorization: Bearer <token>`） |

> 完整的请求/响应示例、错误码与 curl 演示见 **`docs/api/rest.md`**；
> Go → Python 引擎契约见 **`docs/api/engine.md`**。

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

## 分层纪律（AGENTS.md §6.6）

- 本层**不含物理公式**：物理逻辑只在 Python 引擎（`engine/`），本层通过 HTTP 调用
  `omo.api`（FastAPI，M3 接入）；
- 前端只与本服务通信；JSON 字段 snake_case，与 Python 引擎契约一致。

## 当前状态（M3 进行中）

- ✅ 骨架与 CI（Go job：gofmt / vet / build / test）
- ✅ 健康检查 `/health`、`/version`、中间件（日志 + panic 兜底）
- ✅ 数据模型（FilmStack / SimulationTask / TaskResult）
- ✅ 用户系统：注册 / 登录 / JWT 认证（GORM 存储，兼容 sqlite/mysql/postgres，.env 配置）
- ⏳ 任务编排（调 Python 引擎）与任务存储——进行中
