import { defineConfig } from 'vitest/config'

// 桌面 Host 层单测（node 环境）。
//
// 用例会真拉起子进程（假后端 fixture 与真实 Go 后端），因此超时放宽到 20s；
// 被测代码本身不依赖 Electron——Host 层刻意做成 Electron 无关的模块，
// 这样它能被单测覆盖，Electron 相关部分（窗口/菜单/preload）留给 T7。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
