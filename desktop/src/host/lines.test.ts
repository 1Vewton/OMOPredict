import { describe, expect, it } from 'vitest'
import { LineSplitter } from './lines'

describe('LineSplitter', () => {
  it('切分单个 chunk 内的多行，并去掉 CR', () => {
    const s = new LineSplitter()
    expect(s.push('a\r\nb\nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('跨 chunk 的半行会被拼回（stdout 分帧的关键）', () => {
    const s = new LineSplitter()
    expect(s.push('{"jsonrpc":"2.0",')).toEqual([])
    expect(s.push('"id":1}\n')).toEqual(['{"jsonrpc":"2.0","id":1}'])
  })

  it('一个 chunk 里含多行且最后一行不完整时，只吐完整行', () => {
    const s = new LineSplitter()
    expect(s.push('one\ntwo\nthr')).toEqual(['one', 'two'])
    expect(s.pendingBytes).toBe(3)
    expect(s.push('ee\n')).toEqual(['three'])
    expect(s.pendingBytes).toBe(0)
  })

  it('接受 Buffer 并正确解码 UTF-8 多字节字符（跨 chunk 切在字符中间）', () => {
    const s = new LineSplitter()
    const full = Buffer.from('中文行\n', 'utf8')
    // 故意在 UTF-8 字符中间切开
    expect(s.push(full.subarray(0, 4))).toEqual([])
    expect(s.push(full.subarray(4))).toEqual(['中文行'])
  })

  it('忽略空行', () => {
    const s = new LineSplitter()
    expect(s.push('\n\n')).toEqual(['', ''])
  })

  it('超长行被丢弃，且不影响其后的正常分帧', () => {
    const s = new LineSplitter(16)
    const huge = 'x'.repeat(100)
    expect(s.push(huge)).toEqual([]) // 未换行且超限 -> 丢弃缓冲
    expect(s.push('\n')).toEqual([]) // 丢弃持续到本行结束
    expect(s.push('after\n')).toEqual(['after']) // 之后恢复正常
  })

  it('大行（低于上限）不被误丢', () => {
    const s = new LineSplitter(1024)
    const line = 'y'.repeat(500)
    expect(s.push(`${line}\n`)).toEqual([line])
  })
})
