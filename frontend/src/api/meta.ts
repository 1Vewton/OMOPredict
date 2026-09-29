import type { Meta } from '@/types'
import { invoke } from './client'

/**
 * 能力端点（docs/desktop.md D10）：无需认证，任何模式都可访问。
 *
 * 前端据此决定是否要求登录：`auth_required === false` 即单用户本地模式（桌面版）。
 */
export const metaApi = {
  get: (): Promise<Meta> => invoke<Meta>('meta'),
}
