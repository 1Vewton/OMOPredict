<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import HelpTip from '@/components/HelpTip.vue'
import SeChart from '@/components/SeChart.vue'
import SpectrumChart from '@/components/SpectrumChart.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import type {
  OptimizeCandidate,
  OptimizeSensitivityLayer,
  OptimizeTarget,
  SimulationTask,
} from '@/types'

const props = defineProps<{ id: string }>()

const task = ref<SimulationTask | null>(null)
const error = ref('')
const loading = ref(true)
let timer: number | undefined

const isTerminal = computed(
  () => task.value !== null && ['succeeded', 'failed'].includes(task.value.status),
)

async function load(): Promise<void> {
  try {
    task.value = await tasksApi.get(props.id)
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function stopPolling(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
}

function scheduleNext(): void {
  stopPolling()
  if (isTerminal.value) return
  timer = window.setTimeout(async () => {
    await load()
    scheduleNext()
  }, 1500)
}

onMounted(() => {
  void load().then(scheduleNext)
})
onBeforeUnmount(stopPolling)

// ---- kind 分支 ----
const isOptimize = computed(() => task.value?.kind === 'optimize')
const taskTitle = computed(() => {
  const t = task.value
  if (!t) return '任务'
  return t.name || (isOptimize.value ? '目标反推任务' : '仿真任务')
})

const createdAt = computed(() =>
  task.value ? new Date(task.value.created_at * 1000).toLocaleString() : '',
)

// simulate 摘要
const layersText = computed(() =>
  task.value?.stack?.layers
    ? task.value.stack.layers.map((l) => `${l.material} ${l.thickness_nm} nm`).join(' / ')
    : '',
)
const rs = computed(() => task.value?.result?.sheet_resistance ?? null)

// optimize 摘要/目标回显（echo 用户约束，不做物理计算）
function targetText(t: OptimizeTarget | undefined): string {
  if (!t) return '无约束（浏览扫描）'
  const parts: string[] = []
  if (t.min_visible_transmittance !== undefined)
    parts.push(`T ≥ ${(t.min_visible_transmittance * 100).toFixed(0)}%`)
  if (t.max_sheet_resistance !== undefined) parts.push(`Rs ≤ ${t.max_sheet_resistance} Ω/sq`)
  if (t.min_se_db !== undefined) {
    const [lo, hi] = t.se_freq_range_ghz ?? [8.2, 12.4]
    parts.push(`${lo}–${hi} GHz SE ≥ ${t.min_se_db} dB`)
  }
  return parts.length > 0 ? parts.join('，') : '无约束（浏览扫描）'
}
const optimizeTargetDesc = computed(() => targetText(task.value?.optimize?.target))

const report = computed(() => task.value?.optimize_result)
const candidates = computed<OptimizeCandidate[]>(() => report.value?.candidates ?? [])
const bestEffort = computed<OptimizeCandidate | null>(() => report.value?.best_effort ?? null)
const sensLayers = computed<OptimizeSensitivityLayer[]>(
  () => report.value?.sensitivity?.layers ?? [],
)
// 灵敏度条宽：|ΔFoM/FoM| 相对比例（数据可视化缩放，非物理计算）
const barScale = computed(() => {
  const mx = Math.max(0, ...sensLayers.value.map((l) => Math.abs(l.dfom_rel_per_nm)))
  return mx > 0 ? mx : 1
})

// ---- 展示格式化 ----
function fmtThickness(t: [number, number, number]): string {
  return `${t[0]} / ${t[1]} / ${t[2]}`
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
function fmtSe(v: number | null): string {
  return v != null ? `${v.toFixed(1)} dB` : '—'
}
function fmtRs(v: number | null): string {
  return v != null ? `${v.toFixed(2)}` : '—'
}
function layerLabel(i: number): string {
  return i === 1 ? '金属层' : i === 0 ? '外层（入射侧）' : '外层（出射侧）'
}
</script>

<template>
  <div>
    <RouterLink to="/history" class="back-link">← 返回任务历史</RouterLink>

    <div class="section">
      <div class="card">
        <div class="task-head">
          <div>
            <h2 class="page-title">
              {{ taskTitle }}
              <span
                v-if="task"
                class="kind-chip"
                :class="task.kind === 'optimize' ? 'chip-optimize' : 'chip-simulate'"
              >
                {{ task.kind === 'optimize' ? '目标反推' : '仿真' }}
              </span>
              <StatusBadge v-if="task" :status="task.status" />
            </h2>
            <p class="muted">
              <template v-if="task && isOptimize"
                >{{ optimizeTargetDesc }} · 创建于 {{ createdAt }}</template
              >
              <template v-else>{{ layersText || '加载中…' }} · 创建于 {{ createdAt }}</template>
            </p>
          </div>
          <button v-if="isTerminal" class="btn btn-ghost" type="button" @click="load">刷新</button>
        </div>

        <div v-if="loading" class="empty"><span class="spinner"></span>加载任务…</div>

        <div v-else-if="error && !task" class="alert alert-error">
          {{ error }}
          <button class="btn btn-ghost mt-8" type="button" @click="load">重试</button>
        </div>

        <div
          v-else-if="task?.status === 'pending' || task?.status === 'running'"
          class="alert alert-info"
        >
          <span class="spinner"></span>
          {{
            isOptimize
              ? '目标反推计算中（厚度网格扫描 + 灵敏度分析，约数秒）…'
              : '仿真计算中（TMM 光学 + 方阻 + 屏蔽）…'
          }}
        </div>

        <div v-else-if="task?.status === 'failed'" class="alert alert-error">
          {{ isOptimize ? '反推失败' : '仿真失败' }}：{{ task.error || '未知错误' }}
        </div>

        <!-- simulate 结果 -->
        <template v-else-if="task?.status === 'succeeded' && !isOptimize && task.result">
          <div class="metric-grid">
            <div class="metric-card">
              <div class="metric-label">方阻 Rs<HelpTip k="result.rs" /></div>
              <div class="metric-value">
                {{ rs != null ? `${rs.toFixed(2)} Ω/sq` : '—' }}
              </div>
              <div class="metric-note">
                {{ rs != null ? '含尺寸效应（Fuchs–Sondheimer）' : '无导电层' }}
              </div>
            </div>
          </div>

          <div class="chart-card">
            <div class="card-title">
              光学性能：透过率 / 反射率光谱<HelpTip k="result.spectrum" />
            </div>
            <SpectrumChart
              :transmittance="task.result.transmittance"
              :reflectance="task.result.reflectance"
            />
          </div>

          <div class="chart-card">
            <div class="card-title">电磁屏蔽效能（1–18 GHz）</div>
            <SeChart v-if="task.result.se_db.length > 0" :se-db="task.result.se_db" />
            <div v-else class="empty">无导电层，无屏蔽数据</div>
          </div>
        </template>

        <!-- optimize 结果 -->
        <template v-else-if="task?.status === 'succeeded' && isOptimize && report">
          <div class="metric-grid">
            <div class="metric-card">
              <div class="metric-label">扫描组合</div>
              <div class="metric-value">{{ report.n_scanned }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">可行方案</div>
              <div class="metric-value">{{ report.n_feasible }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">扫描用时</div>
              <div class="metric-value">
                {{
                  report.elapsed_seconds != null ? `${report.elapsed_seconds.toFixed(1)} s` : '—'
                }}
              </div>
            </div>
          </div>

          <div v-if="candidates.length > 0" class="chart-card">
            <div class="card-title">可行候选（按 FoM = T¹⁰/Rs 降序，外层 / 金属 / 外层 nm）</div>
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>厚度组合 (nm)</th>
                  <th>T_vis</th>
                  <th>Rs (Ω/sq)</th>
                  <th>SE_min<HelpTip k="result.semin" /></th>
                  <th>FoM<HelpTip k="optimize.fom" /></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in candidates" :key="i">
                  <td class="muted">{{ i + 1 }}</td>
                  <td class="mono">{{ fmtThickness(c.thicknesses_nm) }}</td>
                  <td>{{ fmtPct(c.visible_transmittance) }}</td>
                  <td>{{ fmtRs(c.sheet_resistance) }}</td>
                  <td>{{ fmtSe(c.se_min_db) }}</td>
                  <td class="mono">{{ c.fom != null ? c.fom.toFixed(4) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else-if="bestEffort" class="alert alert-info">
            没有满足全部约束的组合。最接近参考（全体 FoM 最高，不满足约束）：
            <b class="mono">{{ fmtThickness(bestEffort.thicknesses_nm) }} nm</b>
            · T_vis {{ fmtPct(bestEffort.visible_transmittance) }} · Rs
            {{ fmtRs(bestEffort.sheet_resistance) }} Ω/sq
          </div>

          <div v-if="candidates.length > 0 && sensLayers.length > 0" class="chart-card">
            <div class="card-title">Top 候选灵敏度与工艺窗口（每 nm 变化的影响）</div>
            <table class="table">
              <thead>
                <tr>
                  <th>层</th>
                  <th>材料 / 厚度</th>
                  <th style="width: 200px">ΔFoM/FoM（相对）<HelpTip k="result.sensbar" /></th>
                  <th>ΔT_vis</th>
                  <th>Δlog₁₀Rs</th>
                  <th>工艺窗口<HelpTip k="result.window" /></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in sensLayers" :key="l.layer_index">
                  <td>{{ layerLabel(l.layer_index) }}</td>
                  <td class="mono">{{ l.material }} {{ l.thickness_nm }} nm</td>
                  <td>
                    <div class="bar-cell">
                      <div class="bar-track">
                        <div
                          class="bar"
                          :style="{ width: `${(Math.abs(l.dfom_rel_per_nm) / barScale) * 100}%` }"
                        ></div>
                      </div>
                      <span class="mono bar-val"
                        >{{ l.dfom_rel_per_nm >= 0 ? '+' : ''
                        }}{{ l.dfom_rel_per_nm.toFixed(4) }}</span
                      >
                    </div>
                  </td>
                  <td class="mono">
                    {{ l.dt_abs_per_nm >= 0 ? '+' : '' }}{{ l.dt_abs_per_nm.toFixed(5) }}
                  </td>
                  <td class="mono">
                    {{ l.dlog10_rs_per_nm != null ? l.dlog10_rs_per_nm.toFixed(4) : '—' }}
                  </td>
                  <td>{{ l.tolerance_nm != null ? `±${l.tolerance_nm} nm` : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted note">
              工艺窗口 = 该层单独偏离标称厚度仍保持目标可行的容差（其余层不动）。
            </p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back-link {
  display: inline-block;
  margin-bottom: 14px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 13px;
}

.back-link:hover {
  color: var(--color-primary);
}

.page-title {
  font-size: 18px;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.task-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.kind-chip {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.chip-simulate {
  background: rgb(100 116 139 / 0.12);
  color: var(--color-text-muted);
}

.chip-optimize {
  background: rgb(37 99 235 / 0.12);
  color: var(--color-primary-dark);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.metric-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 14px 16px;
  background: linear-gradient(180deg, rgb(37 99 235 / 0.04), transparent);
}

.metric-label {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-bottom: 6px;
}

.metric-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-primary-dark);
  font-variant-numeric: tabular-nums;
}

.metric-note {
  color: var(--color-text-muted);
  font-size: 12px;
  margin-top: 4px;
}

.chart-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
}

.chart-card .card-title {
  margin-bottom: 10px;
  font-size: 15px;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}

.bar-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--color-bg);
  overflow: hidden;
}

.bar {
  height: 100%;
  background: var(--color-primary);
  border-radius: 999px;
  min-width: 2px;
}

.bar-val {
  width: 64px;
  text-align: right;
  font-size: 12px;
}

.note {
  font-size: 12px;
  margin: 10px 0 0;
}
</style>
