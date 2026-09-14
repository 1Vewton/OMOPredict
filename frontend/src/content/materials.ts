// 引擎材料注册表（镜像 engine/src/omo/materials.py 的默认注册表）。
//
// 用途：前端在提交前就能给出明确提示，避免"提交后任务失败"的困惑。
// 与后端保持一致：新增材料时需同时更新 engine 注册表与本列表。

/** 引擎默认支持的材料（大小写敏感，与注册表键一致）。 */
export const KNOWN_MATERIALS = ['ITO', 'Ag', 'glass'] as const

/** 材料名是否被引擎支持（忽略首尾空白）。 */
export function isKnownMaterial(name: string): boolean {
  const n = name.trim()
  return (KNOWN_MATERIALS as readonly string[]).includes(n)
}

/** 人类可读的支持列表（错误提示用）。 */
export function knownMaterialsText(): string {
  return KNOWN_MATERIALS.join(' / ')
}
