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
| `/design` | 参数设计 | 膜层表（材料/厚度）+ 体系模板 + 衬底折射率 → 提交仿真任务 |
| `/optimize` | 目标反推 | 性能目标（T/Rs/SE 约束 + 模板）→ 提交 kind=optimize 任务（可调扫描空间） |
| `/tasks/:id` | 任务结果 | 按 kind 分支：simulate → T(λ)/R(λ) 光谱 + SE(f) + Rs 卡；optimize → 候选表 + 灵敏度/工艺窗口 |
| `/history` | 任务历史 | 类型（仿真/反推）+ 状态 + 摘要，有待处理任务时自动刷新 |

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
- **数值输入容错**：一律用 `utils/number.ts` 的 `parseNumberInput` 取数（支持全角、`10,5` 小数逗号、
  `1,500` 千分位、粘贴带单位或百分号如 `40 nm` / `85%` / `12 Ω/sq`）
- **提交前前置校验**：材料白名单（`content/materials.ts`，与引擎注册表同源）、
  步长/候选数/SE 频带合法性、扫描组合数上限（`MAX_COMBINATIONS`，超限给出耗时预估与建议），
  避免"提交后才失败"；不使用原生 `confirm/alert`（嵌入式 webview 可能禁用），改用内联提示
- 表单包在 `<form @submit.prevent>` 内，输入框按回车即可提交
