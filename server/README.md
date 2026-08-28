# server —— Go 中间层（M3）

用户管理 / 数据持久化 / 仿真任务编排，对外提供 REST API。

## 结构（Go 标准布局）

```
server/
├── cmd/omopredict/        # 主程序入口（HTTP 服务，优雅退出）
└── internal/
    ├── api/               # REST 路由与中间件（健康检查；任务/用户路由后续）
    ├── model/             # 数据模型（膜结构、仿真任务、结果）—— snake_case JSON
    ├── user/              # 用户注册/登录/JWT（实现中）
    └── task/              # 仿真任务编排：生命周期 + 调用 Python 引擎（实现中）
```

## 常用命令

```bash
cd server
go build ./...     # 编译
go test ./...      # 测试
go vet ./...       # 静态检查
go run ./cmd/omopredict   # 启动（默认 :8080，可用 OMO_SERVER_ADDR 覆盖）
```

## 分层纪律（AGENTS.md §6.6）

- 本层**不含物理公式**：物理逻辑只在 Python 引擎（`engine/`），本层通过 HTTP 调用
  `omo.api`（FastAPI，M3 接入）；
- 前端只与本服务通信；JSON 字段 snake_case，与 Python 引擎契约一致。

## 当前状态（M3 进行中）

- ✅ 骨架与 CI（Go job：gofmt / vet / build / test）
- ✅ 健康检查 `/health`、`/version`、中间件（日志 + panic 兜底）
- ✅ 数据模型（FilmStack / SimulationTask / TaskResult）
- ⏳ 用户系统（注册/登录/JWT）、存储、任务编排（调 Python）——进行中
