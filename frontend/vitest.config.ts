import { fileURLToPath, URL } from 'node:url'

import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

// 前端单测配置（桌面版 T9 落地的 §7「契约一致性测试」前端部分）。
//
// - 复用 vite.config.ts 的插件与 `@` 别名，避免测试与构建的解析规则漂移；
// - 单独的 vitest.config.ts（而非在 vite.config.ts 里加 test 块）：生产构建不依赖测试工具；
// - jsdom 环境：token.ts 用 localStorage、client.ts 用 window 事件、transport.ts 检测 window.omo。
export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      restoreMocks: true,
      unstubGlobals: true,
    },
  }),
)
