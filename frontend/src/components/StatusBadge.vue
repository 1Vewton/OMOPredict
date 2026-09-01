<script setup lang="ts">
import type { TaskStatus } from '@/types'

const props = defineProps<{ status: TaskStatus }>()

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: '排队中',
  running: '计算中',
  succeeded: '已完成',
  failed: '失败',
}
</script>

<template>
  <span class="badge" :class="`badge-${props.status}`">{{ STATUS_TEXT[props.status] }}</span>
</template>
