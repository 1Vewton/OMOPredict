# OMOPredict Frontend（M4）

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
pnpm dev          # http://127.0.0.1:5173
```

Vite dev server 将 `/api` 代理到 Go 中间层（默认 `http://127.0.0.1:8080`，
可用环境变量 `OMO_SERVER_URL` 覆盖），规避开发期 CORS；生产部署由反向代理（nginx 等）完成同样转发。

## 常用命令

```bash
pnpm dev          # 开发服务器
pnpm build        # vue-tsc 类型检查 + 生产构建（产物 dist/）
pnpm preview      # 预览生产构建
pnpm lint         # ESLint 检查
pnpm format       # Prettier 格式化
```

## 页面与路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | 登录/注册 | 注册成功**不自动登录**，跳回登录页再登录；JWT 存 localStorage |
| `/design` | 参数设计 | 膜层表（材料/厚度）+ 体系模板 + 衬底折射率 → 提交任务 |
| `/tasks/:id` | 任务结果 | 轮询任务状态 → Rs 指标卡 + T(λ)/R(λ) 光谱 + SE(f) 曲线 |
| `/history` | 任务历史 | 任务列表（状态徽章、结构摘要），有待处理任务时自动刷新 |

## 目录结构

```
src/
├── api/            # HTTP 客户端（http.ts 统一 JWT/错误处理）+ auth/tasks 接口
├── components/     # StatusBadge、SpectrumChart、SeChart
├── composables/    # useEChart（ECharts 生命周期封装）
├── router/         # 路由 + 认证守卫
├── stores/         # Pinia：auth（token/user 持久化）
├── styles/         # 全局样式
├── types/          # 与后端 JSON 契约对应的 TS 类型
└── views/          # LoginView / DesignView / TaskDetailView / HistoryView
```

## 约定

- 字段命名 snake_case，与 `docs/api/rest.md` 契约一致（AGENTS.md §6.7）
- **分层纪律**：前端不计算物理量，只渲染后端返回的 T(λ)/R(λ)/Rs/SE(f)
- 认证失效（401）统一跳转登录页
