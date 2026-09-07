<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import HelpTip from '@/components/HelpTip.vue'
import type { OptimizeSpace, OptimizeTarget } from '@/types'

const router = useRouter()

// 常用目标模板（约束；数值为百分比/Ω/sq/dB）
interface Preset {
  label: string
  minTPercent?: number
  maxRs?: number
  minSe?: number
}

const PRESETS: Preset[] = [
  { label: '高透透明电极 T≥85% · Rs≤10', minTPercent: 85, maxRs: 10 },
  { label: '透明导电 + 屏蔽 T≥85% · Rs≤12 · SE≥25', minTPercent: 85, maxRs: 12, minSe: 25 },
  { label: '柔性基底方案 T≥80% · Rs≤15', minTPercent: 80, maxRs: 15 },
  { label: '无约束浏览（按 FoM 排序）', minTPercent: 0 },
]

const form = reactive({
  name: '',
  minTPercent: '', // 空 = 不限
  maxRs: '',
  minSe: '',
  seLo: 8.2,
  seHi: 12.4,
  useSensitivity: true,
})

// 高级：扫描空间（空 = 引擎默认：ITO/Ag/ITO，外层 20–80 步长 4、金属 5–20 步长 1）
const advanced = reactive({
  outerMin: '',
  outerMax: '',
  outerStep: '',
  metalMin: '',
  metalMax: '',
  metalStep: '',
  topN: '',
})
const showAdvanced = ref(false)

const error = ref('')
const submitting = ref(false)

function applyPreset(p: Preset): void {
  form.minTPercent = p.minTPercent ? String(p.minTPercent) : ''
  form.maxRs = p.maxRs ? String(p.maxRs) : ''
  form.minSe = p.minSe ? String(p.minSe) : ''
}

function num(s: string): number | null {
  if (s.trim() === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function validate(): string | null {
  const t = num(form.minTPercent)
  if (t !== null && (t <= 0 || t > 100)) return '透过率下限需在 (0, 100]% 内'
  const rs = num(form.maxRs)
  if (rs !== null && rs <= 0) return '方阻上限需 > 0'
  const se = num(form.minSe)
  if (se !== null && se <= 0) return 'SE 下限需 > 0 dB'
  if (se !== null && form.seLo >= form.seHi) return 'SE 频带需满足 lo < hi'
  // 扫描空间：成对校验
  const pairs: Array<[string, string, string]> = [
    ['外层厚度范围（nm）', advanced.outerMin, advanced.outerMax],
    ['金属层厚度范围（nm）', advanced.metalMin, advanced.metalMax],
  ]
  for (const [label, a, b] of pairs) {
    if ((a.trim() === '') !== (b.trim() === '')) {
      return `${label}需同时给出下限与上限（或都留空用默认）`
    }
    if (a.trim() !== '' && num(a)! >= num(b)!) return `${label}需满足 min < max`
  }
  return null
}

function buildTarget(): OptimizeTarget {
  const target: OptimizeTarget = {}
  const t = num(form.minTPercent)
  if (t !== null) target.min_visible_transmittance = t / 100
  const rs = num(form.maxRs)
  if (rs !== null) target.max_sheet_resistance = rs
  const se = num(form.minSe)
  if (se !== null) {
    target.min_se_db = se
    target.se_freq_range_ghz = [form.seLo, form.seHi]
  }
  return target
}

function buildSpace(): OptimizeSpace {
  const s: OptimizeSpace = {}
  const oMin = num(advanced.outerMin)
  const oMax = num(advanced.outerMax)
  if (oMin !== null && oMax !== null) {
    s.outer_bounds_nm = [oMin, oMax]
    const oStep = num(advanced.outerStep)
    if (oStep !== null) s.outer_step_nm = oStep
  }
  const mMn = num(advanced.metalMin)
  const mMx = num(advanced.metalMax)
  if (mMn !== null && mMx !== null) {
    s.metal_bounds_nm = [mMn, mMx]
    const mStep = num(advanced.metalStep)
    if (mStep !== null) s.metal_step_nm = mStep
  }
  const topN = num(advanced.topN)
  if (topN !== null) s.top_n = Math.trunc(topN)
  return s
}

const constraintsText = (): string => {
  const parts: string[] = []
  const t = num(form.minTPercent)
  if (t !== null) parts.push(`T ≥ ${t}%`)
  const rs = num(form.maxRs)
  if (rs !== null) parts.push(`Rs ≤ ${rs} Ω/sq`)
  const se = num(form.minSe)
  if (se !== null) parts.push(`${form.seLo}–${form.seHi} GHz SE ≥ ${se} dB`)
  return parts.length > 0 ? parts.join('，') : '无约束（浏览扫描）'
}

async function submit(): Promise<void> {
  error.value = ''
  const msg = validate()
  if (msg) {
    error.value = msg
    return
  }
  const target = buildTarget()
  const space = buildSpace()
  const hasAnyConstraint =
    target.min_visible_transmittance !== undefined ||
    target.max_sheet_resistance !== undefined ||
    target.min_se_db !== undefined
  if (
    !hasAnyConstraint &&
    !window.confirm('未设任何约束将做无约束浏览扫描（按 FoM 排序），继续？')
  ) {
    return
  }
  submitting.value = true
  try {
    const task = await tasksApi.create({
      kind: 'optimize',
      name: form.name.trim() || undefined,
      optimize: {
        target,
        space: Object.keys(space).length > 0 ? space : undefined,
        compute_sensitivity: form.useSensitivity,
      },
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
    <h2 class="page-title">目标反推</h2>
    <p class="muted intro">
      设定性能目标，系统在 OMO 三层（ITO/Ag/ITO）厚度空间上反向扫描， 返回满足约束的膜厚组合（按 FoM
      = T¹⁰/Rs 排序）与最佳方案的灵敏度/工艺窗口。
    </p>

    <div class="section">
      <div class="card">
        <div class="card-title">常用目标模板</div>
        <div class="preset-row">
          <button
            v-for="p in PRESETS"
            :key="p.label"
            type="button"
            class="btn btn-ghost preset-btn"
            @click="applyPreset(p)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="card">
        <div class="card-title">性能目标（留空 = 不限该约束）</div>
        <div class="constraint-grid">
          <div class="field">
            <label for="min-t">可见光平均透过率下限<HelpTip k="optimize.tvis" /></label>
            <div class="input-suffix">
              <input
                id="min-t"
                v-model="form.minTPercent"
                class="input"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="如 85"
              />
              <span class="suffix">%</span>
            </div>
          </div>
          <div class="field">
            <label for="max-rs">方阻上限<HelpTip k="optimize.rs" /></label>
            <div class="input-suffix">
              <input
                id="max-rs"
                v-model="form.maxRs"
                class="input"
                type="number"
                min="0"
                step="0.5"
                placeholder="如 12"
              />
              <span class="suffix">Ω/sq</span>
            </div>
          </div>
          <div class="field">
            <label for="min-se">屏蔽效能下限（X 波段）<HelpTip k="optimize.se" /></label>
            <div class="input-suffix">
              <input
                id="min-se"
                v-model="form.minSe"
                class="input"
                type="number"
                min="0"
                step="1"
                placeholder="如 25"
              />
              <span class="suffix">dB</span>
            </div>
          </div>
          <div v-if="form.minSe !== ''" class="field">
            <label>SE 频带（GHz）<HelpTip k="optimize.band" /></label>
            <div class="band-row">
              <input v-model.number="form.seLo" class="input" type="number" step="0.1" />
              <span class="muted">–</span>
              <input v-model.number="form.seHi" class="input" type="number" step="0.1" />
            </div>
          </div>
        </div>
        <label class="check-row">
          <input v-model="form.useSensitivity" type="checkbox" />
          计算 Top 候选的逐层灵敏度与工艺窗口
          <HelpTip k="optimize.sensitivity" />
        </label>
      </div>
    </div>

    <div class="section">
      <div class="card">
        <button
          type="button"
          class="btn btn-ghost advanced-toggle"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? '▾' : '▸' }} 高级：扫描空间（可选，默认 ITO/Ag/ITO · 外层 20–80 步长 4 ·
          金属 5–20 步长 1）<HelpTip k="optimize.space" />
        </button>
        <div v-if="showAdvanced" class="advanced-body">
          <div class="field">
            <label>外层厚度范围（nm）与步长</label>
            <div class="triple-row">
              <input
                v-model="advanced.outerMin"
                class="input"
                type="number"
                step="1"
                placeholder="min（如 20）"
              />
              <span class="muted">~</span>
              <input
                v-model="advanced.outerMax"
                class="input"
                type="number"
                step="1"
                placeholder="max（如 80）"
              />
              <input
                v-model="advanced.outerStep"
                class="input"
                type="number"
                min="0.1"
                step="0.5"
                placeholder="步长（如 4）"
              />
            </div>
          </div>
          <div class="field">
            <label>金属层厚度范围（nm）与步长</label>
            <div class="triple-row">
              <input
                v-model="advanced.metalMin"
                class="input"
                type="number"
                step="0.5"
                placeholder="min（如 5）"
              />
              <span class="muted">~</span>
              <input
                v-model="advanced.metalMax"
                class="input"
                type="number"
                step="0.5"
                placeholder="max（如 20）"
              />
              <input
                v-model="advanced.metalStep"
                class="input"
                type="number"
                min="0.1"
                step="0.5"
                placeholder="步长（如 1）"
              />
            </div>
          </div>
          <div class="field inline-field">
            <label for="top-n">返回候选数<HelpTip k="optimize.topn" /></label>
            <input
              id="top-n"
              v-model="advanced.topN"
              class="input"
              type="number"
              min="1"
              max="50"
              step="1"
              placeholder="默认 10"
            />
          </div>
          <p class="muted note">
            材料体系固定 ITO/Ag/ITO（引擎默认）；更大范围/更细步长会显著增加扫描时间（默认 ~4k
            组合约数秒）。
          </p>
        </div>
      </div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="card submit-card">
      <div class="submit-info">
        <span class="muted">目标：</span><span>{{ constraintsText() }}</span>
      </div>
      <button
        class="btn btn-primary submit-btn"
        type="button"
        :disabled="submitting"
        @click="submit"
      >
        <span v-if="submitting" class="spinner"></span>
        开始反推
      </button>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 20px;
  margin: 0 0 4px;
}

.intro {
  margin: 0 0 16px;
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

.constraint-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0 20px;
}

.input-suffix {
  display: flex;
  align-items: center;
  gap: 6px;
}

.input-suffix .suffix {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.band-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.band-row .input {
  width: 72px;
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.advanced-toggle {
  width: 100%;
  justify-content: flex-start;
  font-weight: 400;
}

.advanced-body {
  margin-top: 14px;
  border-top: 1px dashed var(--color-border);
  padding-top: 14px;
}

.triple-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.triple-row .input {
  width: 130px;
}

.inline-field {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 300px;
}

.inline-field label {
  margin: 0;
  white-space: nowrap;
}

.inline-field .input {
  width: 110px;
}

.note {
  font-size: 12px;
  margin: 8px 0 0;
}

.submit-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.submit-btn {
  min-width: 130px;
}
</style>
