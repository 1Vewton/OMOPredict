// 数值输入容错解析：自由输入（全角、千分位/小数逗号、粘贴带单位或百分号）也能正确取数。
// 用于参数设计的厚度、目标反推的约束与扫描空间等文本框。

/** 常见单位/百分号：解析时剥离（大小写不敏感）。 */
const UNIT_RE = /(%|percent|nm|ghz|db|Ω\/sq|Ω|ohm|ω)/gi

/** 合法数字（含可选指数）：整数/小数，允许 "40." 与 ".5"。 */
const NUMBER_RE = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** 全角数字与常见全角符号 → 半角（含全角逗号/句点、中文标点）。 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。｡]/g, '.')
    .replace(/[，、]/g, ',')
    .replace(/[－—–−ー]/g, '-')
    .replace(/＋/g, '+')
    .replace(/[\u3000\u00A0]/g, ' ')
}

/**
 * 规范化数字主体（不含符号）：处理千分位与逗号小数。
 *
 * 规则（消除 "1,500" 与 "10,5" 的歧义）：
 * - 逗号 + 句点：仅接受合法千分位（`1,234.5`），否则视为非法；
 * - 仅逗号：
 *   - `1,234` / `1,234,567` → 千分位（去逗号）；
 *   - `10,5` / `,5` / `10,` → 逗号作小数分隔符；
 *   - 其余（如 `4,0.5`、`1,23,456`）→ 非法。
 *
 * @returns 规范化后的数字字符串；非法时 null
 */
function normalizeBody(body: string): string | null {
  if (body === '') return null
  const hasComma = body.includes(',')
  const hasDot = body.includes('.')

  if (hasComma && hasDot) {
    return /^\d{1,3}(,\d{3})+\.\d+$/.test(body) ? body.replace(/,/g, '') : null
  }
  if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(body)) return body.replace(/,/g, '') // 千分位
    const parts = body.split(',')
    if (parts.length !== 2) return null
    const [intPart, fracPart] = parts
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null
    if (intPart === '' && fracPart === '') return null
    return `${intPart || '0'}.${fracPart}` // 小数逗号
  }
  return body
}

/**
 * 解析用户输入的数值。
 *
 * 容错：首尾空白、全角数字/标点、千分位与逗号小数、粘贴带单位
 * （`40 nm`、`85%`、`12 Ω/sq`、`25 dB`、`8.2 GHz`）。
 *
 * @param raw 原始输入（字符串/数字/null）
 * @returns 有限数值；空串或无法解析时返回 null
 */
export function parseNumberInput(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  let s = toHalfWidth(String(raw)).trim()
  if (s === '') return null

  s = s.replace(UNIT_RE, '').replace(/\s/g, '')
  if (s === '') return null

  const sign = s.startsWith('-') ? '-' : s.startsWith('+') ? '' : ''
  if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1)

  const body = normalizeBody(s)
  if (body === null) return null
  if (!NUMBER_RE.test(body)) return null

  const v = Number(sign + body)
  return Number.isFinite(v) ? v : null
}

/** 输入是否为空（空白串/undefined/null）。 */
export function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || String(raw).trim() === ''
}

/** 把输入框显示值规范化为纯数字字符串（用于回填，可选）。 */
export function displayNumber(raw: unknown): string {
  const v = parseNumberInput(raw)
  return v === null ? '' : String(v)
}
