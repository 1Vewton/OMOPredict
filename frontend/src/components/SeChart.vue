<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { computed, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import type { SpectrumPoint } from '@/types'

const props = defineProps<{ seDb: SpectrumPoint[] }>()

const container = ref<HTMLDivElement | null>(null)
const { setOption } = useEChart(container)

const option = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['屏蔽效能 SE'], top: 0 },
  grid: { left: 56, right: 20, top: 44, bottom: 48 },
  xAxis: {
    type: 'value',
    name: '频率 (GHz)',
    nameLocation: 'middle',
    nameGap: 30,
  },
  yAxis: {
    type: 'value',
    name: 'SE (dB)',
    axisLabel: { formatter: (v: number) => v.toFixed(1) },
  },
  series: [
    {
      name: '屏蔽效能 SE',
      type: 'line',
      data: props.seDb.map((p) => [p.x, p.value]),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
    },
  ],
}))

watch(option, (o) => setOption(o), { immediate: true, deep: true })
</script>

<template>
  <div ref="container" class="chart"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 320px;
}
</style>
