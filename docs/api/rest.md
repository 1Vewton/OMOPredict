# 对外 REST API（Go 中间层）

服务入口：`server/cmd/omopredict`，默认监听 `:8080`（`OMO_SERVER_ADDR` 可改）。

## 健康检查

### `GET /health`

```json
200 {"status":"ok","version":"0.1.0","time":"2026-08-28T12:07:07Z"}
```

### `GET /version`

```json
200 {"version":"0.1.0","go":"go1.25.0"}
```

## 用户认证

### `POST /api/auth/register` — 注册

请求：

```json
{"username": "alice", "password": "secret123"}
```

| 状态码 | 含义 |
|---|---|
| `201` | 成功 → `{"id":"<32位hex>","username":"alice"}` |
| `400` | 用户名非法（3-32 位 `[a-zA-Z0-9_]`）/ 密码过短（<8）/ JSON 解析失败 |
| `409` | 用户名已存在 |

### `POST /api/auth/login` — 登录（签发 JWT）

请求同上。成功返回：

```json
200 {
  "token": "<JWT, HS256>",
  "user": {"id": "<32位hex>", "username": "alice"}
}
```

| 状态码 | 含义 |
|---|---|
| `200` | 成功（token 有效期默认 24h，`OMO_JWT_TTL` 可调） |
| `400` | JSON 解析失败 |
| `401` | 用户名不存在或密码错误 |

### `GET /api/auth/me` — 当前用户（需认证）

请求头：`Authorization: Bearer <token>`

| 状态码 | 含义 |
|---|---|
| `200` | `{"id":"...","username":"alice"}` |
| `401` | 缺少 / 非法 / 已过期 token |

## curl 演示

```bash
# 注册
curl -X POST http://127.0.0.1:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# 登录拿 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}' | jq -r .token)

# 带 token 访问受保护接口
curl http://127.0.0.1:8080/api/auth/me -H "Authorization: Bearer $TOKEN"
```

## 错误约定

- 错误体：`{"error": "<消息>"}`
- 4xx：客户端问题（参数/认证/冲突）；5xx：服务端问题（panic 由中间件兜底为 500）

## 实现位置

- 路由与中间件：`server/internal/api/`（`router.go`、`auth.go`、`middleware.go`）
- 业务：`server/internal/user/`（`service.go`：bcrypt + JWT；`store.go`：GORM 存储）
- 测试：`server/internal/api/*_test.go`、`server/internal/user/*_test.go`
