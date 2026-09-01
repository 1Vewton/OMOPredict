<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import StatusBadge from '@/components/StatusBadge.vue'
import type { SimulationTask } from '@/types'

const tasks = ref<SimulationTask[]>([])
const loading = ref(true)
const error = ref('')
let timer: number | undefined

const hasActive = computed(() =>
  tasks.value.some((t) => t.status === 'pending' || t.status === 'running'),
)

async function load(): Promise<void> {
  try {
    const res = await tasksApi.list()
    tasks.value = res.tasks
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
  // 有待处理任务时自动刷新，跟踪异步执行进度
  timer = window.setInterval(() => {
    if (hasActive.value) void load()
  }, 3000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
})

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString()
}

function stackText(t: SimulationTask): string {
  return t.stack.layers.map((l) => `${l.material} ${l.thickness_nm}nm`).join(' / ')
}

function rsText(t: SimulationTask): string {
  const rs = t.result?.sheet_resistance
  return rs != null ? `${rs.toFixed(2)} Ω/sq` : '—'
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title">任务历史</h2>
      <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="card">
      <div v-if="loading && tasks.length === 0" class="empty">
        <span class="spinner"></span>加载任务…
      </div>

      <div v-else-if="tasks.length === 0" class="empty">
        暂无仿真任务，去<a href="/design">参数设计</a>页创建第一个任务吧
      </div>

      <table v-else class="table">
        <thead>
          <tr>
            <th>状态</th>
            <th>名称</th>
            <th>膜结构</th>
            <th>方阻</th>
            <th>创建时间</th>
            <th style="width: 72px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.id">
            <td><StatusBadge :status="t.status" /></td>
            <td>{{ t.stack.name || '未命名' }}</td>
            <td class="stack-cell" :title="stackText(t)">{{ stackText(t) }}</td>
            <td>{{ rsText(t) }}</td>
            <td class="muted">{{ fmtTime(t.created_at) }}</td>
            <td>
              <RouterLink class="view-link" :to="{ name: 'task-detail', params: { id: t.id } }">
                查看
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-title {
  font-size: 20px;
  margin: 0;
}

.stack-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-link {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 13px;
}

.view-link:hover {
  text-decoration: underline;
}
</style>
