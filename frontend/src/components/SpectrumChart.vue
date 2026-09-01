<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { computed, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import type { SpectrumPoint } from '@/types'

const props = defineProps<{
  transmittance: SpectrumPoint[]
  reflectance: SpectrumPoint[]
}>()

const container = ref<HTMLDivElement | null>(null)
const { setOption } = useEChart(container)

const option = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['透过率 T', '反射率 R'], top: 0 },
  grid: { left: 56, right: 20, top: 44, bottom: 48 },
  xAxis: {
    type: 'value',
    name: '波长 (nm)',
    nameLocation: 'middle',
    nameGap: 30,
    axisLabel: { formatter: (v: number) => String(v) },
  },
  yAxis: {
    type: 'value',
    name: 'T / R',
    min: 0,
    max: 1,
    axisLabel: { formatter: (v: number) => v.toFixed(2) },
  },
  series: [
    {
      name: '透过率 T',
      type: 'line',
      data: props.transmittance.map((p) => [p.x, p.value]),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
    },
    {
      name: '反射率 R',
      type: 'line',
      data: props.reflectance.map((p) => [p.x, p.value]),
      smooth: true,
      showSymbol: false,
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
