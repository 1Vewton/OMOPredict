// ECharts 轻量封装：按需注册（仅折线图 + 常用组件），
// 统一处理实例生命周期与容器尺寸自适应。
import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { Ref } from 'vue'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/**
 * ECharts 生命周期封装。
 *
 * 用法：组件中创建容器 ref 并传入，模板以 `ref="container"` 绑定：
 *
 * ```vue
 * const container = ref<HTMLDivElement | null>(null)
 * const { setOption } = useEChart(container)
 * ```
 *
 * @param container 图表容器元素引用（模板 ref 绑定）
 */
export function useEChart(container: Ref<HTMLDivElement | null>) {
  const chart = shallowRef<EChartsType | null>(null)
  let observer: ResizeObserver | null = null

  onMounted(() => {
    if (!container.value) return
    chart.value = init(container.value)
    observer = new ResizeObserver(() => chart.value?.resize())
    observer.observe(container.value)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    chart.value?.dispose()
    chart.value = null
  })

  function setOption(option: EChartsCoreOption): void {
    chart.value?.setOption(option, { notMerge: true })
  }

  return { setOption }
}
