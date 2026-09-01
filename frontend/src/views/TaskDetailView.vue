<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import SeChart from '@/components/SeChart.vue'
import SpectrumChart from '@/components/SpectrumChart.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import type { SimulationTask } from '@/types'

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

const layersText = computed(() =>
  task.value
    ? task.value.stack.layers.map((l) => `${l.material} ${l.thickness_nm} nm`).join(' / ')
    : '',
)

const createdAt = computed(() =>
  task.value ? new Date(task.value.created_at * 1000).toLocaleString() : '',
)

const rs = computed(() => task.value?.result?.sheet_resistance ?? null)
</script>

<template>
  <div>
    <RouterLink to="/history" class="back-link">← 返回任务历史</RouterLink>

    <div class="section">
      <div class="card">
        <div class="task-head">
          <div>
            <h2 class="page-title">
              {{ task?.stack.name || '仿真任务' }}
              <StatusBadge v-if="task" :status="task.status" />
            </h2>
            <p class="muted">{{ layersText || '加载中…' }} · 创建于 {{ createdAt }}</p>
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
          仿真计算中（TMM 光学 + 方阻 + 屏蔽），请稍候…
        </div>

        <div v-else-if="task?.status === 'failed'" class="alert alert-error">
          仿真失败：{{ task.error || '未知错误' }}
        </div>

        <template v-else-if="task?.status === 'succeeded' && task.result">
          <div class="metric-grid">
            <div class="metric-card">
              <div class="metric-label">方阻 Rs</div>
              <div class="metric-value">
                {{ rs != null ? `${rs.toFixed(2)} Ω/sq` : '—' }}
              </div>
              <div class="metric-note">
                {{ rs != null ? '含尺寸效应（Fuchs–Sondheimer）' : '无导电层' }}
              </div>
            </div>
          </div>

          <div class="chart-card">
            <div class="card-title">光学性能：透过率 / 反射率光谱</div>
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
}

.task-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.metric-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 16px;
  background: linear-gradient(180deg, rgb(37 99 235 / 0.04), transparent);
}

.metric-label {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-bottom: 6px;
}

.metric-value {
  font-size: 26px;
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
  margin-bottom: 8px;
  font-size: 15px;
}
</style>
