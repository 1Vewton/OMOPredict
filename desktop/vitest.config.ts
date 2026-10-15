import { defineConfig } from 'vitest/config'

// 桌面 Host 层单测（node 环境）。
//
// 用例会真拉起子进程（假后端 fixture 与真实 Go 后端），因此超时放宽到 20s；
// 被测代码本身不依赖 Electron——Host 层刻意做成 Electron 无关的模块，
// 这样它能被单测覆盖，Electron 相关部分（窗口/菜单/preload）留给 T7。
export default defineConfig({
  test: {
    environment: 'node',
    // src/shell/localBridge.test.ts 覆盖 scripts/lib/local-bridge.mjs（T9 的本地调试桥）：
    // 那个 .mjs 是零依赖的纯 Node 模块，挂在桌面工程下测可以复用这里"会真起子进程/真监听"
    // 的 node 环境，而不必给 scripts/ 单独建一套 JS 工具链。
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
