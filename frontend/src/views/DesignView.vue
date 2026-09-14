<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import HelpTip from '@/components/HelpTip.vue'
import { KNOWN_MATERIALS, isKnownMaterial, knownMaterialsText } from '@/content/materials'
import { parseNumberInput } from '@/utils/number'
import type { Layer } from '@/types'

const router = useRouter()

// 引擎材料注册表（与后端同源，见 content/materials.ts）
const MATERIAL_SUGGESTIONS = KNOWN_MATERIALS

interface LayerRow {
  material: string
  thickness: string
}

interface Preset {
  name: string
  layers: Layer[]
}

// 常用体系模板（材料均为引擎注册表内）
const PRESETS: Preset[] = [
  {
    name: 'ITO/Ag/ITO 40-10-40',
    layers: [
      { material: 'ITO', thickness_nm: 40 },
      { material: 'Ag', thickness_nm: 10 },
      { material: 'ITO', thickness_nm: 40 },
    ],
  },
  {
    name: 'ITO/Ag/ITO 50-8-50',
    layers: [
      { material: 'ITO', thickness_nm: 50 },
      { material: 'Ag', thickness_nm: 8 },
      { material: 'ITO', thickness_nm: 50 },
    ],
  },
  {
    name: 'Ag 单层 10 nm',
    layers: [{ material: 'Ag', thickness_nm: 10 }],
  },
]

const taskName = ref('')
const substrateIndex = ref(1.5)
const layers = reactive<LayerRow[]>([
  { material: 'ITO', thickness: '40' },
  { material: 'Ag', thickness: '10' },
  { material: 'ITO', thickness: '40' },
])
const error = ref('')
const submitting = ref(false)

const summary = computed(() =>
  layers.map((l) => `${l.material.trim() || '?'} ${l.thickness || '?'} nm`).join(' / '),
)

function addLayer(): void {
  layers.push({ material: 'ITO', thickness: '10' })
}

function removeLayer(index: number): void {
  layers.splice(index, 1)
}

function applyPreset(preset: Preset): void {
  layers.splice(
    0,
    layers.length,
    ...preset.layers.map((l) => ({ material: l.material, thickness: String(l.thickness_nm) })),
  )
  taskName.value = preset.name
}

function validate(): string | null {
  if (layers.length === 0) {
    return '至少需要一层膜'
  }
  for (const [i, l] of layers.entries()) {
    const material = l.material.trim()
    if (!material) {
      return `第 ${i + 1} 层：材料不能为空`
    }
    if (!isKnownMaterial(material)) {
      return `第 ${i + 1} 层：材料「${material}」不被引擎支持（可选：${knownMaterialsText()}）`
    }
    const t = parseNumberInput(l.thickness)
    if (t === null) {
      return `第 ${i + 1} 层：厚度需为数值（nm），如 40、40.5 或 40 nm`
    }
    if (t < 0) {
      return `第 ${i + 1} 层：厚度不能为负（nm）`
    }
  }
  // 衬底折射率：留空 = 用引擎默认（1.5）
  const sub = parseNumberInput(substrateIndex.value)
  if (sub !== null && sub <= 0) {
    return '衬底折射率需为正数（留空则用默认 1.5）'
  }
  return null
}

async function submit(): Promise<void> {
  error.value = ''
  const msg = validate()
  if (msg) {
    error.value = msg
    return
  }
  submitting.value = true
  try {
    const sub = parseNumberInput(substrateIndex.value)
    const task = await tasksApi.create({
      name: taskName.value.trim() || undefined,
      layers: layers.map((l) => ({
        material: l.material.trim(),
        thickness_nm: parseNumberInput(l.thickness) ?? 0,
      })),
      substrate_index: sub ?? undefined, // 留空 → 引擎默认 1.5
    })
    router.push({ name: 'task-detail', params: { id: task.id } })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '提交失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <h2 class="page-title">参数设计</h2>

    <!-- 包成 form：支持在任意输入框按回车提交（并统一走 submit 校验） -->
    <form @submit.prevent="submit">
      <div class="section">
        <div class="card">
          <div class="card-title">常用体系模板</div>
          <div class="preset-row">
            <button
              v-for="p in PRESETS"
              :key="p.name"
              type="button"
              class="btn btn-ghost preset-btn"
              @click="applyPreset(p)"
            >
              {{ p.name }}
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="card">
          <div class="card-title">膜层结构（入射侧 → 出射侧）</div>

          <div class="field">
            <label for="task-name">任务名称（可选）</label>
            <input
              id="task-name"
              v-model="taskName"
              class="input"
              type="text"
              placeholder="例如：ITO-Ag-ITO 40-10-40"
            />
          </div>

          <table class="table">
            <thead>
              <tr>
                <th class="th-id">#<HelpTip k="design.order" placement="right" /></th>
                <th>材料<HelpTip k="design.material" /></th>
                <th style="width: 220px">厚度（nm）<HelpTip k="design.thickness" /></th>
                <th style="width: 80px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(layer, i) in layers" :key="i">
                <td class="muted">{{ i + 1 }}</td>
                <td>
                  <input
                    v-model="layer.material"
                    class="input input-sm"
                    type="text"
                    list="material-suggestions"
                    placeholder="ITO / Ag / glass"
                  />
                </td>
                <td>
                  <input
                    v-model="layer.thickness"
                    class="input input-sm"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    placeholder="如 40 / 40.5"
                  />
                </td>
                <td>
                  <button
                    class="btn btn-danger btn-sm"
                    type="button"
                    :disabled="layers.length <= 1"
                    @click="removeLayer(i)"
                  >
                    删除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <datalist id="material-suggestions">
            <option v-for="m in MATERIAL_SUGGESTIONS" :key="m" :value="m"></option>
          </datalist>

          <div class="row-actions">
            <button class="btn btn-ghost" type="button" @click="addLayer">+ 添加层</button>
          </div>

          <div class="field mt-16 substrate-field">
            <label for="substrate-index">衬底折射率<HelpTip k="design.substrate" /></label>
            <input
              id="substrate-index"
              v-model="substrateIndex"
              class="input"
              type="number"
              min="0"
              step="any"
              inputmode="decimal"
              placeholder="留空 = 1.5"
            />
            <span class="muted">默认 1.5（玻璃），留空即用默认</span>
          </div>
        </div>
      </div>

      <div v-if="error" class="alert alert-error" role="alert" aria-live="polite">{{ error }}</div>

      <div class="card submit-card">
        <div class="submit-info">
          <span class="muted">结构预览：</span>
          <span>{{ summary || '（空）' }}</span>
        </div>
        <button class="btn btn-primary submit-btn" type="submit" :disabled="submitting">
          <span v-if="submitting" class="spinner"></span>
          提交仿真
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 20px;
  margin: 0 0 16px;
}

/* # 列表头：问号帮助图标与 # 保持同行 */
.th-id {
  width: 80px;
  white-space: nowrap;
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-btn {
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
}

.row-actions {
  margin-top: 12px;
}

.substrate-field {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 360px;
}

.substrate-field label {
  margin: 0;
  white-space: nowrap;
}

.substrate-field .input {
  width: 120px;
}

.submit-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.submit-info {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submit-btn {
  min-width: 130px;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 13px;
}
</style>
