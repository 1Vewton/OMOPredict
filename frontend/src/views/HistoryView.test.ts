// 历史页删除交互单测：两段式内联确认的状态机与列表更新。
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, removeMock } = vi.hoisted(() => ({ listMock: vi.fn(), removeMock: vi.fn() }))

vi.mock('@/api/tasks', () => ({
  tasksApi: { list: listMock, remove: removeMock, get: vi.fn(), create: vi.fn() },
}))

import HistoryView from './HistoryView.vue'
import type { SimulationTask } from '@/types'

function task(id: string, name: string): SimulationTask {
  return {
    id,
    user_id: 'local',
    kind: 'simulate',
    name,
    status: 'succeeded',
    created_at: 1_757_600_000,
    updated_at: 1_757_600_000,
  }
}

/** 挂载并等待首次加载完成。RouterLink 用简单桩替代（本用例不关心路由）。 */
async function mountView(tasks: SimulationTask[]) {
  listMock.mockResolvedValue({ tasks })
  const wrapper = mount(HistoryView, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return wrapper
}

/** 按文本找按钮（行内"删除/确认删除/取消"都是 button）。 */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const btn = wrapper.findAll('button').find((b) => b.text() === text)
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

beforeEach(() => {
  listMock.mockReset()
  removeMock.mockReset()
})

describe('HistoryView 删除任务', () => {
  it('首次点击进入确认态，不发送删除请求（避免误删）', async () => {
    const wrapper = await mountView([task('t1', '任务一')])

    await buttonByText(wrapper, '删除').trigger('click')

    expect(removeMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').some((b) => b.text() === '确认删除')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '取消')).toBe(true)

    wrapper.unmount()
  })

  it('第二次点击真正删除，并从列表移除该行', async () => {
    removeMock.mockResolvedValue({ id: 't1', deleted: true })
    const wrapper = await mountView([task('t1', '任务一'), task('t2', '任务二')])
    expect(wrapper.text()).toContain('任务一')
    expect(wrapper.text()).toContain('任务二')

    await buttonByText(wrapper, '删除').trigger('click')
    await buttonByText(wrapper, '确认删除').trigger('click')
    await flushPromises()

    expect(removeMock).toHaveBeenCalledWith('t1')
    expect(wrapper.text()).not.toContain('任务一')
    expect(wrapper.text()).toContain('任务二') // 只删目标行

    wrapper.unmount()
  })

  it('取消回到初始态，不发送删除请求', async () => {
    const wrapper = await mountView([task('t1', '任务一')])

    await buttonByText(wrapper, '删除').trigger('click')
    await buttonByText(wrapper, '取消').trigger('click')

    expect(removeMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '确认删除')).toBe(false)

    wrapper.unmount()
  })

  it('删除失败：展示错误且列表不变（行保留）', async () => {
    const { ApiError } = await import('@/api/http')
    removeMock.mockRejectedValue(new ApiError(404, 'task not found'))
    const wrapper = await mountView([task('t1', '任务一')])

    await buttonByText(wrapper, '删除').trigger('click')
    await buttonByText(wrapper, '确认删除').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('task not found')
    expect(wrapper.text()).toContain('任务一')
    // 失败后确认态被复位
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(true)

    wrapper.unmount()
  })

  it('无任务时展示空态提示', async () => {
    const wrapper = await mountView([])
    expect(wrapper.text()).toContain('暂无任务')
    wrapper.unmount()
  })
})
