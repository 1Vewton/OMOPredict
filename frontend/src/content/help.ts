// 前端帮助文案集中目录：视图/组件只引用键名，不在模板里散落硬编码说明。
// 新增提示：在此登记 k 与文本，然后在模板用 <HelpTip k="..."/> 引用。
// 文本须与引擎/后端语义一致（docs/physics、docs/api），避免误导。

export const help = {
  // ---- 登录/注册 ----
  'login.username': '用户名 3–32 位，仅限字母、数字、下划线，创建后不可修改。',
  'login.password':
    '注册密码需同时满足：至少 8 位、包含字母、包含数字；登录时需重新输入注册时设置的密码。',

  // ---- 参数设计（正向仿真）----
  'design.order':
    '膜层从入射侧（空气）向出射侧（衬底）排列；典型 OMO 把金属层（Ag）夹在两层氧化物（ITO）之间。',
  'design.material':
    '材料名须在引擎材料库中：ITO / Ag / glass。输入库外名称会在提交时被引擎拒绝（未知材料）。',
  'design.thickness':
    '单层厚度（nm）。推荐区间：氧化物层 20–80 nm、金属层 5–15 nm（引擎尺寸效应模型在该区间可靠）。',
  'design.substrate':
    '出射衬底折射率，默认 1.5（玻璃）。它参与 TMM 光学计算，改变会影响透过率/反射率结果。',

  // ---- 目标反推 ----
  'optimize.tvis':
    '可见光（400–800 nm）平均透过率下限。引擎内部用 0–1 分数，这里按百分比填（85 = 85%）。',
  'optimize.rs':
    '方阻上限（Ω/sq）。多层膜并联等效 + Fuchs–Sondheimer 尺寸效应，金属层越薄方阻越大。',
  'optimize.se': '屏蔽效能下限（dB）。取评估频带内最差的 SE 点是否达标（最保守口径）。',
  'optimize.band': 'SE 约束的评估频带（GHz）。默认 X 波段 8.2–12.4；频率网格为 1–18 GHz 整数点。',
  'optimize.sensitivity':
    '对 Top 可行候选做 ±1 nm 差分：给出每层厚度每变化 1 nm 对 FoM / T_vis / Rs 的影响，以及保持目标可行的工艺窗口（单层厚度容差）。',
  'optimize.space':
    '扫描空间：三个厚度轴各自在 [min, max] 内按步长取点，组合总数 = 外层点数 × 金属点数 × 外层点数。默认约 4096 组、引擎求值约数秒；范围越大、步长越细越慢。留空即用引擎默认（外层 20–80 步长 4、金属 5–20 步长 1）。',
  'optimize.topn': '返回的可行候选条数上限，按 FoM 从高到低排序。',
  'optimize.browse': '不设任何约束时不筛选，按 FoM = T_vis¹⁰/Rs 降序浏览全部组合。',
  'optimize.fom':
    'Haacke 品质因子 FoM = T_vis¹⁰ / Rs：兼顾透过率与导电性的横向比较指标，越高越好（透过率衰减被 10 次方放大）。',

  // ---- 任务历史 ----
  'history.status':
    'pending = 排队中 · running = 计算中 · succeeded = 完成 · failed = 失败。存在未完成任务时列表每 3 秒自动刷新。',
  'history.kind':
    '任务类型：仿真 = 正向计算给定膜层的光学/电学/屏蔽性能；目标反推 = 由性能目标反推候选膜厚组合。',

  // ---- 结果页 ----
  'result.rs': '多层并联方阻（含超薄金属 Fuchs–Sondheimer 尺寸效应）；无导电层时为 —。',
  'result.spectrum':
    'T(λ)/R(λ) 由物理引擎（TMM）计算返回，前端只展示不二次计算；无散射假设下 A = 1 − T − R。',
  'result.semin': 'SE_min：评估频带内屏蔽效能的最小值（dB），为最保守口径；无导电层时为 —。',
  'result.sensbar': 'ΔFoM/FoM 为相对变化率，条越长说明该层厚度对综合性能影响越大。',
  'result.window':
    '工艺窗口：仅该层偏离标称厚度（其余层不变）时，仍满足全部目标约束的最大 ± 容差——可理解为镀膜允许的厚度波动范围。',
} as const

export type HelpKey = keyof typeof help
