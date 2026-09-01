// M4 前端 ESLint 扁平配置（ESLint 9）。
// 基于 Vue 官方 TS 配置 + Prettier 冲突消解（不做格式化强校验，格式化走 pnpm format）。
import eslintConfigPrettier from '@vue/eslint-config-prettier'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

export default defineConfigWithVueTs(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      // 页面/组件命名：单文件视图名（如 LoginView）不算"多词"，允许单文件名
      'vue/multi-word-component-names': 'off',
    },
  },
)
