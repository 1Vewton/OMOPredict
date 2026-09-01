<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/

// 注册密码合规规则（登录不做此校验，仅注册强制）
interface PasswordRule {
  label: string
  test: (p: string) => boolean
}

const PASSWORD_RULES: PasswordRule[] = [
  { label: '至少 8 位', test: (p) => p.length >= 8 },
  { label: '包含字母', test: (p) => /[a-zA-Z]/.test(p) },
  { label: '包含数字', test: (p) => /\d/.test(p) },
]

function passwordOk(p: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(p))
}

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  error.value = ''
  success.value = ''
  confirmPassword.value = ''
}

function validate(): string | null {
  if (!USERNAME_RE.test(username.value.trim())) {
    return '用户名需为 3-32 位字母、数字或下划线'
  }
  if (mode.value === 'register') {
    if (!passwordOk(password.value)) {
      return '密码需至少 8 位且同时包含字母和数字'
    }
    if (password.value !== confirmPassword.value) {
      return '两次输入的密码不一致'
    }
  } else if (!password.value) {
    return '请输入密码'
  }
  return null
}

async function submit(): Promise<void> {
  error.value = ''
  success.value = ''
  const msg = validate()
  if (msg) {
    error.value = msg
    return
  }
  loading.value = true
  try {
    const name = username.value.trim()
    if (mode.value === 'login') {
      await auth.login(name, password.value)
      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/design'
      router.push(redirect)
    } else {
      // 注册：只创建账号，不自动登录；跳回登录页（保留用户名、清空密码）
      await auth.register(name, password.value)
      mode.value = 'login'
      password.value = ''
      confirmPassword.value = ''
      success.value = `注册成功，请登录（${name}）`
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '请求失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="card login-card">
      <div class="login-head">
        <div class="brand">
          <span class="brand-mark">OMO</span>
          <span>OMOPredict</span>
        </div>
        <p class="muted login-sub">OMO 纳米多层薄膜仿真与设计</p>
      </div>

      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: mode === 'login' }"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: mode === 'register' }"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div v-if="success" class="alert alert-success">{{ success }}</div>

      <form @submit.prevent="submit">
        <div class="field">
          <label for="username">用户名</label>
          <input
            id="username"
            v-model="username"
            class="input"
            type="text"
            autocomplete="username"
            placeholder="3-32 位字母、数字或下划线"
          />
        </div>

        <div class="field">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            :placeholder="mode === 'register' ? '至少 8 位，含字母和数字' : '请输入密码'"
          />
          <div v-if="mode === 'register'" class="password-hint">
            <span
              v-for="rule in PASSWORD_RULES"
              :key="rule.label"
              class="hint-item"
              :class="{ ok: rule.test(password) }"
            >
              <span class="hint-mark">{{ rule.test(password) ? '✓' : '○' }}</span>
              {{ rule.label }}
            </span>
          </div>
        </div>

        <div v-if="mode === 'register'" class="field">
          <label for="confirm-password">确认密码</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入密码"
          />
        </div>

        <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          {{ mode === 'login' ? '登录' : '注册' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  display: flex;
  justify-content: center;
  padding-top: 8vh;
}

.login-card {
  width: 100%;
  max-width: 380px;
  padding: 28px;
}

.login-head {
  text-align: center;
  margin-bottom: 16px;
}

.login-head .brand {
  justify-content: center;
  font-size: 20px;
}

.login-sub {
  margin: 6px 0 0;
  font-size: 13px;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  background: var(--color-bg);
  border-radius: 8px;
  padding: 4px;
}

.tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-muted);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.tab.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 500;
  box-shadow: var(--shadow);
}

.password-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.hint-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.hint-item.ok {
  color: var(--color-success);
}

.hint-mark {
  display: inline-block;
  width: 14px;
  text-align: center;
}
</style>
