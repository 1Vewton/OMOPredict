<script setup lang="ts">
import { ref } from 'vue'
import { help, type HelpKey } from '@/content/help'

const props = withDefaults(
  defineProps<{
    /** 帮助文案键（集中维护于 src/content/help.ts） */
    k: HelpKey
    /** 提示气泡位置，默认底部 */
    placement?: 'top' | 'bottom' | 'left' | 'right'
  }>(),
  { placement: 'bottom' },
)

const text = help[props.k]
const open = ref(false)

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}
</script>

<template>
  <span
    class="help-tip"
    :class="[`pos-${props.placement}`, { open }]"
    tabindex="0"
    role="button"
    aria-label="帮助：{{ text }}"
    @click.stop="toggle"
    @blur="close"
    @keydown.enter.prevent="toggle"
    @keydown.escape="close"
  >
    <svg class="help-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M6.4 6.2a1.7 1.7 0 0 1 3.3.5c0 1.1-1.4 1.4-1.6 2.4"
        stroke="#fff"
        stroke-width="1.4"
        fill="none"
        stroke-linecap="round"
      />
      <circle cx="8.15" cy="11.2" r="0.9" fill="#fff" />
    </svg>
    <span class="tip-bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.help-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: -2px;
  margin-left: 5px;
  outline: none;
  cursor: help;
  border-radius: 999px;
}

.help-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  opacity: 0.85;
  transition:
    color 0.15s ease,
    opacity 0.15s ease;
}

.help-tip:hover .help-icon,
.help-tip:focus-visible .help-icon,
.help-tip.open .help-icon {
  color: var(--color-primary);
  opacity: 1;
}

.tip-bubble {
  position: absolute;
  z-index: 40;
  width: 260px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.55;
  text-align: left;
  white-space: normal;
  border: 1px solid var(--color-border);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
  pointer-events: none;
  opacity: 0;
  transform: translateY(3px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
  word-break: break-word;
}

.help-tip:hover .tip-bubble,
.help-tip:focus-visible .tip-bubble,
.help-tip.open .tip-bubble {
  opacity: 1;
  transform: translateY(0);
}

.pos-bottom .tip-bubble {
  top: calc(100% + 6px);
  left: 50%;
  margin-left: -130px;
}

.pos-top .tip-bubble {
  bottom: calc(100% + 6px);
  left: 50%;
  margin-left: -130px;
}

.pos-right .tip-bubble {
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-2px);
}

.pos-right:hover .tip-bubble,
.pos-right:focus-visible .tip-bubble,
.pos-right.open .tip-bubble {
  transform: translateY(-50%);
}

.pos-left .tip-bubble {
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-2px);
}

.pos-left:hover .tip-bubble,
.pos-left:focus-visible .tip-bubble,
.pos-left.open .tip-bubble {
  transform: translateY(-50%);
}
</style>
