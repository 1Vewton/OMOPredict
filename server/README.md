# server —— Go 中间层（M3）

用户管理 / 数据持久化 / 仿真任务编排，对外提供 REST API。

## 结构（Go 标准布局）

```
server/
├── cmd/omopredict/        # 主程序入口（HTTP 服务，优雅退出）
└── internal/
    ├── api/               # REST 路由与中间件（健康检查、认证接口）
    ├── model/             # 数据模型（膜结构、仿真任务、结果）—— snake_case JSON
    ├── user/              # 用户注册/登录 + JWT（store: SQLite / service: bcrypt + JWT）
    └── task/              # 仿真任务编排：生命周期 + 调用 Python 引擎（实现中）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/auth/register` | 注册（username 3-32 位 [a-zA-Z0-9_]，密码 ≥8 位） |
| POST | `/api/auth/login` | 登录，返回 `{token, user}`（JWT HS256） |
| GET | `/api/auth/me` | 当前用户（需 `Authorization: Bearer <token>`） |

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OMO_SERVER_ADDR` | `:8080` | 监听地址 |
| `OMO_DB_PATH` | `omopredict.db` | SQLite 数据库路径 |
| `OMO_JWT_SECRET` | 开发默认值（**生产必须设置**） | JWT 签名密钥 |
| `OMO_JWT_TTL` | `24h` | 令牌有效期（Go duration 格式） |

## 常用命令

```bash
cd server
go build ./...     # 编译
go test ./...      # 测试
go vet ./...       # 静态检查
go run ./cmd/omopredict   # 启动（默认 :8080）
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
- ✅ 用户系统：注册 / 登录 / JWT 认证（bcrypt 哈希 + SQLite 持久化），全链路冒烟通过
- ⏳ 任务编排（调 Python 引擎）与任务存储——进行中
