import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// M4 前端：Vite 配置。
// /api 代理到 Go 中间层（:8080，默认），规避开发期 CORS（Go 服务暂未配 CORS）。
// 生产部署时由 nginx 等反向代理完成同样转发。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.OMO_SERVER_URL ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
