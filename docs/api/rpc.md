# stdio JSON-RPC 契约（桌面版：Electron ↔ Go 中间层）

> 适用形态：桌面版（docs/desktop.md D11）。Web 部署仍用 HTTP（见 [`rest.md`](rest.md)）。
> 实现：`server/internal/rpc/`；启动：`omopredict --stdio`（需 `OMO_AUTH_MODE=none`）。

## 1. 协议

- **JSON-RPC 2.0**，**换行分隔（JSON-Lines）**：每行一个 JSON 对象，UTF-8 字节流。
- **stdout 只承载协议**；日志一律走 stderr（含 GORM/SQL 日志——见 §5 注意事项）。
- 单行上限 16 MiB（`optimize` 报告可达数百 KB）。
- **无 id 的行视为通知**：执行但不回复。

```
请求：{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{...}}
成功：{"jsonrpc":"2.0","id":1,"result":{...}}
失败：{"jsonrpc":"2.0","id":1,"error":{"code":400,"message":"layers 至少需要一层"}}
```

## 2. 方法 ↔ HTTP 端点（载荷逐字段相同）

| RPC 方法 | HTTP 等价 | 参数 | 结果 |
|---|---|---|---|
| `ping` | `GET /health` | 无 | `{"status":"ok","version":"0.1.0"}` |
| `meta` | `GET /api/meta` | 无 | `{version, auth_mode, auth_required, engine_transport}` |
| `tasks.create` | `POST /api/tasks` | 同 HTTP 请求体 | 新建任务对象（`status=pending`） |
| `tasks.list` | `GET /api/tasks` | 无 | `{"tasks":[...]}` |
| `tasks.get` | `GET /api/tasks/{id}` | `{"id":"<32hex>"}` | 任务对象（含结果） |
| `tasks.delete` | `DELETE /api/tasks/{id}` | `{"id":"<32hex>"}` | `{"id":"...","deleted":true}` |
| `auth.register` / `auth.login` / `auth.me` | `/api/auth/*` | — | **仅 Web（jwt）模式**；stdio 固定单用户，返回 401 `auth disabled in single-user (local) mode` |

**载荷一致性**由测试保证：`server/internal/rpc/contract_test.go` 用同一请求分别经 HTTP 与 RPC 执行，
断言 `meta`、`tasks.create`（simulate 与 optimize）、校验错误消息、404 消息、删除响应结构完全一致。

### 请求/响应示例

```json
{"jsonrpc":"2.0","id":1,"method":"tasks.create","params":{
  "kind":"simulate","name":"ITO-Ag-ITO",
  "layers":[{"material":"ITO","thickness_nm":40},
            {"material":"Ag","thickness_nm":10},
            {"material":"ITO","thickness_nm":40}]}}
```

```json
{"jsonrpc":"2.0","id":1,"result":{"id":"9c1f...","kind":"simulate","user_id":"local",
  "stack":{"name":"ITO-Ag-ITO","layers":[...]},"status":"pending","created_at":1757600000}}
```

`kind=optimize` 的任务：`optimize_result` 为引擎反推报告原样（`n_scanned`/`n_feasible`/`candidates`/`sensitivity`）。

## 3. 错误码

**应用错误沿用 HTTP 状态码语义**（便于前端复用 HTTP 模式的错误处理）：

| code | 含义 | 典型场景 |
|---|---|---|
| `400` | 请求非法 | `kind` 非法、simulate 缺 `layers`、optimize 缺参数、缺 `id` |
| `401` | 未认证 | `auth.*` 方法（stdio 固定单用户，认证关闭） |
| `404` | 不存在 | 任务不存在或非本人（统一 404，不泄露存在性） |
| `500` | 服务端错误 | 存储层失败 |

**协议错误使用 JSON-RPC 保留码**：

| code | 含义 |
|---|---|
| `-32700` | JSON 解析失败 |
| `-32600` | 非法请求（缺 `method`） |
| `-32601` | 方法不存在 |
| `-32602` | 参数非法（含未知字段——严格解析，避免拼写错误被静默忽略） |

## 4. 认证与单用户模式

stdio 传输**没有 HTTP 头**，无法承载 Bearer token，因此固定为单用户本地模式：

- 需 `OMO_AUTH_MODE=none`；若以 `--stdio` 启动而模式为 `jwt`，**进程直接报错退出**（不静默降级）。
- 所有任务归属固定用户（`user_id = "local"`），无需任何凭证。
- `auth.*` 方法一律返回 401（与 HTTP none 模式行为一致）。

## 5. 注意事项（实现约束）

1. **stdout 只能有协议数据**：任何库往 stdout 打印（如 GORM 默认日志）都会破坏 JSON-Lines。
   本项目已把 GORM 日志路由到 stderr（`store.Config.LogWriter`，默认 `os.Stderr`），
   并有回归测试 `TestGORMLoggerUsesConfiguredWriter` 守护。
2. **父进程关闭 stdin 后**，正在执行的任务会失去宿主进程、停留在 `pending`/`running`
   （桌面 Host 会保持管道打开；异常退出场景的清理策略见 docs/desktop.md §12）。
3. 单行上限 16 MiB；两侧读缓冲需放大（Host 侧同样处理）。
4. 协议与 HTTP 共用同一服务层与请求 DTO（`task.CreateRequest`、`task.Service.GetOwned/DeleteOwned`），
   新增方法时应同步更新本文档与 `contract_test.go`。
