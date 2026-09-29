<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import HelpTip from '@/components/HelpTip.vue'
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

// 删除采用两段式内联确认（项目约定：不用原生 confirm，嵌入式 webview 可能禁用）
const confirmId = ref<string | null>(null)
const deletingId = ref<string | null>(null)

/** 首次点击进入确认态；再次点击才真正删除。 */
async function remove(t: SimulationTask): Promise<void> {
  if (confirmId.value !== t.id) {
    confirmId.value = t.id
    return
  }
  deletingId.value = t.id
  try {
    await tasksApi.remove(t.id)
    tasks.value = tasks.value.filter((x) => x.id !== t.id)
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '删除失败，请稍后重试'
  } finally {
    deletingId.value = null
    confirmId.value = null
  }
}

function cancelRemove(): void {
  confirmId.value = null
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

function kindText(t: SimulationTask): string {
  return t.kind === 'optimize' ? '目标反推' : '仿真'
}

function nameText(t: SimulationTask): string {
  return t.name || t.stack?.name || '未命名'
}

/** 摘要列：simulate → 膜结构；optimize → 扫描/可行数（成功时）。 */
function contentText(t: SimulationTask): string {
  if (t.kind === 'optimize') {
    const r = t.optimize_result
    if (r) return `${r.n_scanned} 组合 · ${r.n_feasible} 可行`
    return t.status === 'failed' ? '反推失败' : '目标反推'
  }
  if (!t.stack?.layers) return '—'
  return t.stack.layers.map((l) => `${l.material} ${l.thickness_nm}nm`).join(' / ')
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title">任务历史<HelpTip k="history.status" /></h2>
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
        暂无任务，去<a href="/design">参数设计</a>或<a href="/optimize">目标反推</a>创建第一个吧
      </div>

      <table v-else class="table">
        <thead>
          <tr>
            <th>类型<HelpTip k="history.kind" /></th>
            <th>状态</th>
            <th>名称</th>
            <th>内容</th>
            <th>创建时间</th>
            <th style="width: 132px">操作<HelpTip k="history.delete" /></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.id">
            <td>
              <span
                class="kind-tag"
                :class="t.kind === 'optimize' ? 'tag-optimize' : 'tag-simulate'"
              >
                {{ kindText(t) }}
              </span>
            </td>
            <td><StatusBadge :status="t.status" /></td>
            <td>{{ nameText(t) }}</td>
            <td class="stack-cell" :title="contentText(t)">{{ contentText(t) }}</td>
            <td class="muted">{{ fmtTime(t.created_at) }}</td>
            <td>
              <div class="row-actions">
                <RouterLink class="view-link" :to="{ name: 'task-detail', params: { id: t.id } }">
                  查看
                </RouterLink>
                <template v-if="confirmId === t.id">
                  <button
                    class="link-btn danger"
                    type="button"
                    :disabled="deletingId === t.id"
                    @click="remove(t)"
                  >
                    {{ deletingId === t.id ? '删除中…' : '确认删除' }}
                  </button>
                  <button class="link-btn" type="button" @click="cancelRemove">取消</button>
                </template>
                <button v-else class="link-btn" type="button" @click="remove(t)">删除</button>
              </div>
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

.kind-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.tag-simulate {
  background: rgb(100 116 139 / 0.12);
  color: var(--color-text-muted);
}

.tag-optimize {
  background: rgb(37 99 235 / 0.12);
  color: var(--color-primary-dark);
}

.view-link {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 13px;
}

.view-link:hover {
  text-decoration: underline;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 行内"文字按钮"：与查看链接同视觉重量，避免表格里出现一排实体按钮 */
.link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.link-btn:hover:not(:disabled) {
  color: var(--color-primary);
  text-decoration: underline;
}

.link-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.link-btn.danger {
  color: var(--color-danger);
  font-weight: 500;
}
</style>
