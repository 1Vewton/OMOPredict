<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { tasksApi } from '@/api/tasks'
import HelpTip from '@/components/HelpTip.vue'
import { isBlank, parseNumberInput } from '@/utils/number'
import type { OptimizeSpace, OptimizeTarget } from '@/types'

const router = useRouter()

// 扫描规模上限：超过则提示（引擎硬上限 2e6，但按 3s/4096 组估算耗时，100k 组≈73s 已难等待）
const MAX_COMBINATIONS = 100_000
const DEFAULT_OUTER = { min: 20, max: 80, step: 4 }
const DEFAULT_METAL = { min: 5, max: 20, step: 1 }

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
  seLo: '8.2', // 字符串：自由输入（含单位/逗号）统一经 parseNumberInput 解析
  seHi: '12.4',
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
// 无约束的"浏览扫描"需要二次确认（内联提示，避免依赖原生 confirm）
const browseConfirmed = ref(false)

function applyPreset(p: Preset): void {
  form.minTPercent = p.minTPercent ? String(p.minTPercent) : ''
  form.maxRs = p.maxRs ? String(p.maxRs) : ''
  form.minSe = p.minSe ? String(p.minSe) : ''
}

// 统一用容错解析（支持全角、`,` 小数、粘贴带单位/百分号）
const num = parseNumberInput

/** 网格点数（含端点），步长非法时返回 null。 */
function gridCount(bounds: { min: number; max: number; step: number }): number | null {
  if (!(bounds.step > 0) || !(bounds.min < bounds.max)) return null
  return Math.floor((bounds.max - bounds.min) / bounds.step + 1 + 1e-9)
}

/** 扫描组合数与预估耗时（供提交前提示）。 */
function scanEstimate(): { combos: number; seconds: number } {
  const oMin = num(advanced.outerMin) ?? DEFAULT_OUTER.min
  const oMax = num(advanced.outerMax) ?? DEFAULT_OUTER.max
  const oStep = num(advanced.outerStep) ?? DEFAULT_OUTER.step
  const mMn = num(advanced.metalMin) ?? DEFAULT_METAL.min
  const mMx = num(advanced.metalMax) ?? DEFAULT_METAL.max
  const mStep = num(advanced.metalStep) ?? DEFAULT_METAL.step
  const nOuter = gridCount({ min: oMin, max: oMax, step: oStep }) ?? 0
  const nMetal = gridCount({ min: mMn, max: mMx, step: mStep }) ?? 0
  const combos = nOuter * nMetal * nOuter
  return { combos, seconds: Math.round((combos / 4096) * 3) }
}

function validate(): string | null {
  const t = num(form.minTPercent)
  if (t !== null && (t <= 0 || t > 100)) return '透过率下限需在 (0, 100]% 内（填百分比，如 85）'
  const rs = num(form.maxRs)
  if (rs !== null && rs <= 0) return '方阻上限需 > 0 Ω/sq'
  const se = num(form.minSe)
  if (se !== null && se <= 0) return 'SE 下限需 > 0 dB'

  // SE 频带：仅在设了 SE 约束时校验（自由输入可能清空）
  if (se !== null) {
    const lo = num(form.seLo)
    const hi = num(form.seHi)
    if (lo === null || hi === null) return 'SE 频带需填写数值（GHz），如 8.2 与 12.4'
    if (!(lo > 0)) return 'SE 频带下界需 > 0 GHz'
    if (!(lo < hi)) return 'SE 频带需满足 lo < hi'
  }

  // 扫描空间：成对校验 + 步长/范围校验
  const pairs: Array<[string, string, string, string]> = [
    ['外层厚度范围（nm）', advanced.outerMin, advanced.outerMax, advanced.outerStep],
    ['金属层厚度范围（nm）', advanced.metalMin, advanced.metalMax, advanced.metalStep],
  ]
  for (const [label, a, b, step] of pairs) {
    if (isBlank(a) !== isBlank(b)) {
      return `${label}需同时给出下限与上限（或都留空用默认）`
    }
    if (!isBlank(a)) {
      const lo = num(a)
      const hi = num(b)
      if (lo === null || hi === null) return `${label}需为数值`
      if (!(lo < hi)) return `${label}需满足 min < max`
    }
    if (!isBlank(a) && !isBlank(step)) {
      const st = num(step)
      if (st === null || st <= 0) return `${label}步长需为 > 0 的数值`
    }
  }

  const topN = num(advanced.topN)
  if (!isBlank(advanced.topN)) {
    if (topN === null) return '返回候选数需为数值'
    if (topN < 1 || topN > 50) return '返回候选数需在 1–50 之间'
  }

  // 组合数（含耗时预估）——超限直接给可操作建议，避免提交后长时间无响应或引擎 422
  const { combos, seconds } = scanEstimate()
  if (combos > MAX_COMBINATIONS) {
    return `当前扫描空间约 ${combos} 组合（预计 ${seconds}s），超过上限 ${MAX_COMBINATIONS}；请加大步长或缩小范围`
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
    const lo = num(form.seLo)
    const hi = num(form.seHi)
    // 校验已保证非空，这里兜底为 X 波段默认
    target.se_freq_range_ghz = [lo ?? 8.2, hi ?? 12.4]
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
  if (se !== null)
    parts.push(`${num(form.seLo) ?? 8.2}–${num(form.seHi) ?? 12.4} GHz SE ≥ ${se} dB`)
  return parts.length > 0 ? parts.join('，') : '无约束（浏览扫描）'
}

/** 组合数提示（高级面板与提交区显示）。 */
const estimate = computed(() => scanEstimate())

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

  // 无约束 = 浏览扫描：改为内联二次确认（不用原生 confirm —— 嵌入式 webview/iframe 会禁用或缺失）
  if (!hasAnyConstraint && !browseConfirmed.value) {
    browseConfirmed.value = true
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
    <!-- 包成 form：支持在任意输入框按回车提交 -->
    <form @submit.prevent="submit">
      <p class="muted intro">
        设定性能目标，系统在 OMO 三层（ITO/Ag/ITO）厚度空间上反向扫描， 返回满足约束的膜厚组合（按
        FoM = T¹⁰/Rs 排序）与最佳方案的灵敏度/工艺窗口。
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
                  step="any"
                  inputmode="decimal"
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
                  step="any"
                  inputmode="decimal"
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
                  step="any"
                  inputmode="decimal"
                  placeholder="如 25"
                />
                <span class="suffix">dB</span>
              </div>
            </div>
            <div v-if="!isBlank(form.minSe)" class="field">
              <label>SE 频带（GHz）<HelpTip k="optimize.band" /></label>
              <div class="band-row">
                <input
                  v-model="form.seLo"
                  class="input"
                  type="number"
                  min="0"
                  step="any"
                  inputmode="decimal"
                  placeholder="如 8.2"
                />
                <span class="muted">–</span>
                <input
                  v-model="form.seHi"
                  class="input"
                  type="number"
                  min="0"
                  step="any"
                  inputmode="decimal"
                  placeholder="如 12.4"
                />
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
            {{ showAdvanced ? '▾' : '▸' }} 高级：扫描空间（可选，默认 ITO/Ag/ITO · 外层 20–80 步长 4
            · 金属 5–20 步长 1）<HelpTip k="optimize.space" />
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
              材料体系固定 ITO/Ag/ITO（引擎默认）；更大范围/更细步长会显著增加扫描时间。
              当前扫描空间约 <b>{{ estimate.combos }}</b> 组合（预计
              <b>{{ estimate.seconds }}</b> 秒）。
            </p>
          </div>
        </div>
      </div>

      <div v-if="error" class="alert alert-error" role="alert" aria-live="polite">{{ error }}</div>

      <div v-if="browseConfirmed" class="alert alert-info">
        未设任何约束 → 将做<b>无约束浏览扫描</b>（按 FoM = T¹⁰/Rs 降序列出全部组合，约
        {{ estimate.combos }} 组合 / {{ estimate.seconds }} 秒）。确认请再次点击「开始反推」。
        <button class="btn btn-ghost mt-8" type="button" @click="browseConfirmed = false">
          取消
        </button>
      </div>

      <div class="card submit-card">
        <div class="submit-info">
          <span class="muted">目标：</span><span>{{ constraintsText() }}</span>
        </div>
        <button class="btn btn-primary submit-btn" type="submit" :disabled="submitting">
          <span v-if="submitting" class="spinner"></span>
          {{ browseConfirmed ? '确认浏览扫描' : '开始反推' }}
        </button>
      </div>
    </form>
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
