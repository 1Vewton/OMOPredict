# OMOPredict Frontend（M4 完成；M5 v2 增「目标反推」页）

> **中文** · [English version](README.en.md)

Vue 3 + TypeScript + Vite 前端：参数设计 → 提交仿真任务 → 结果可视化（ECharts）。

## 技术栈

- **框架**：Vue 3（Composition API + `<script setup>`）、Vue Router、Pinia
- **构建**：Vite 7 + TypeScript（vue-tsc 类型检查）
- **可视化**：ECharts 5（按需引入：折线图 + 网格/图例/提示框 + Canvas 渲染）
- **代码质量**：ESLint 9（扁平配置，Vue 官方 TS 规则）+ Prettier

## 快速开始

前置：Go 中间层已启动（`server/`，默认 `:8080`），仿真引擎已启动（`engine/`，`OMO_ENGINE_URL` 指向它）。

```bash
pnpm install
pnpm dev          # http://localhost:5173（dev server 绑 IPv6 ::1，用 127.0.0.1 不通）
```

Vite dev server 将 `/api` 代理到 Go 中间层（默认 `http://127.0.0.1:8080`，
可用环境变量 `OMO_SERVER_URL` 覆盖），规避开发期 CORS；生产部署由反向代理（nginx 等）完成同样转发。

## 常用命令

```bash
pnpm dev          # 开发服务器
pnpm build        # vue-tsc 类型检查 + 生产构建（产物 dist/）
pnpm preview      # 预览生产构建
pnpm lint         # ESLint 检查
pnpm test         # 单元测试（vitest run，jsdom 环境）
pnpm test:watch   # 单元测试（watch 模式）
pnpm format       # Prettier 格式化
```

## 页面与路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录/注册 | 注册成功**不自动登录**，跳回登录页再登录；JWT 存 localStorage。**单用户本地模式下该页会被守卫重定向到 `/design`** |
| `/design` | 参数设计 | 膜层表（材料/厚度）+ 体系模板 + 衬底折射率 → 提交仿真任务 |
| `/optimize` | 目标反推 | 性能目标（T/Rs/SE 约束 + 模板）→ 提交 kind=optimize 任务（可调扫描空间） |
| `/tasks/:id` | 任务结果 | 按 kind 分支：simulate → T(λ)/R(λ) 光谱 + SE(f) + Rs 卡；optimize → 候选表 + 灵敏度/工艺窗口 |
| `/history` | 任务历史 | 类型（仿真/反推）+ 状态 + 摘要 + **删除**（两段式内联确认）；有待处理任务时自动刷新 |

## 目录结构

```
src/
├── api/
│   ├── transport.ts  # 传输抽象：Transport 接口 + 方法↔端点映射 + http/ipc 两实现 + 选择（window.omo）
│   ├── http.ts       # HTTP 实现：fetch + JWT 注入 + 错误消息提取；ApiError 定义处
│   ├── client.ts     # 统一调用入口（401 → 清凭证 + 广播 omo:unauthorized）
│   ├── token.ts      # 凭证持久化（仅 JWT 形态使用）
│   ├── meta.ts       # 能力端点（GET /api/meta）
│   └── auth.ts / tasks.ts   # 业务接口（经 client 调用）
├── components/     # StatusBadge、SpectrumChart、SeChart、HelpTip
├── composables/    # useEChart（ECharts 生命周期封装）
├── content/        # 集中文案（help.ts 悬浮提示、materials.ts 材料白名单）
├── router/         # 路由 + 守卫（先拉 meta，再按模式分流）
├── stores/         # Pinia：auth（token/user + authRequired/isLocalMode 能力门禁）
├── styles/         # 全局样式
├── types/          # 与后端 JSON 契约对应的 TS 类型
├── utils/          # number.ts（数值输入容错）
└── views/          # LoginView / DesignView / OptimizeView / TaskDetailView / HistoryView
```

## 传输与能力门禁（T5，见 `docs/desktop.md` D10/D11）

**传输二选一**：`api/transport.ts` 的 `activeTransport()` 检测 `window.omo`（由桌面壳 preload 注入）——
存在即走 **IPC**（`window.omo.rpc(method, params)`，无网络、无端口），否则走 **HTTP**（`fetch` 相对路径 `/api/...`）。
两种传输的**载荷逐字段相同**（RPC 方法名即 REST 端点，映射表在 `transport.ts`），错误统一为 `ApiError`
（`status` 沿用 HTTP 语义，IPC 侧 `error.code` 同义）。

**能力门禁**：`main.ts` 在挂载前调用 `auth.bootstrap()` 拉取 `meta`，据 `auth_required` 决定是否要求登录：

- `auth_required === false`（桌面单用户）→ 守卫放行全部页面、`/login` 重定向到 `/design`、
  顶栏显示「本地模式」并隐藏用户名/退出、忽略 `omo:unauthorized`；
- `auth_required === true`（Web 默认）→ 维持登录流程；
- **`meta` 拉取失败 → 按"需要认证"兜底**，避免误放行受保护页面。

## 单元测试（vitest）

`pnpm test`（配置见 `vitest.config.ts`，jsdom 环境，复用 vite 的 `@` 别名）。**60 个用例，5 个文件**：

| 文件 | 覆盖 |
|---|---|
| `api/transport.test.ts` | 传输选择（`window.omo` 检测/覆盖）、**全部 RPC 方法→端点映射**（动词/路径/是否带 body）、路径参数编码与缺失报错、JWT 注入、非 2xx 与连接失败的错误归一化、`toApiError` 三种错误形态、**同一套用例经 HTTP 与 IPC 的载荷/结果一致性**（`docs/desktop.md` §7 的前端部分） |
| `api/client.test.ts` | 401（清凭证 + 广播 `omo:unauthorized`）与其它状态码不误清、非 `ApiError` 归一化、方法与参数透传 |
| `stores/auth.test.ts` | 门禁：`auth_required` true/false、**meta 失败兜底为需认证**、初始态默认需认证、`bootstrap` 幂等、登录/登出/注册 |
| `router/guard.test.ts` | 守卫矩阵：Web 模式未认证→跳登录（带 `redirect`）、已认证→放行、本地模式全放行且 `/login`→`/design`、meta 失败仍要求登录 |
| `views/HistoryView.test.ts` | 删除的两段式确认状态机：首次点击只进确认态、二次点击才删并移除该行、取消复位、失败时展示错误且行保留、空态 |

> 仍未建立的是**浏览器端到端 / 真实 Electron 壳的冒烟**（属桌面版 T7/T11）；门禁在真实壳中的行为尚未实测。

## 约定

- 字段命名 snake_case，与 `docs/api/rest.md` 契约一致（AGENTS.md §6.7）
- **分层纪律**：前端不计算物理量，只渲染后端返回的 T(λ)/R(λ)/Rs/SE(f)
- 认证失效（401）统一跳转登录页（单用户本地模式下由 `App.vue` 忽略该事件）
- **数值输入容错**：一律用 `utils/number.ts` 的 `parseNumberInput` 取数（支持全角、`10,5` 小数逗号、
  `1,500` 千分位、粘贴带单位或百分号如 `40 nm` / `85%` / `12 Ω/sq`）
- **提交前前置校验**：材料白名单（`content/materials.ts`，与引擎注册表同源）、
  步长/候选数/SE 频带合法性、扫描组合数上限（`MAX_COMBINATIONS`，超限给出耗时预估与建议），
  避免"提交后才失败"；不使用原生 `confirm/alert`（嵌入式 webview 可能禁用），改用内联提示
- 表单包在 `<form @submit.prevent>` 内，输入框按回车即可提交
