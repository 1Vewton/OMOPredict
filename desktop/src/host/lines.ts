/** 单行上限（与 Go `internal/rpc` 及引擎 `omo/rpc` 对齐：optimize 报告可达数百 KB）。 */
export const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024

/**
 * 把字节流切成行（JSON-Lines 分帧）。
 *
 * 单独成模块是因为两处都要用（Go 后端 stdout、引擎 stdout），且**跨 chunk 的半分行**
 * 与**超长行**是最容易写错的地方——stdout 是协议流，多切或少切一行就会错位。
 */
export class LineSplitter {
  private buffer: Buffer = Buffer.alloc(0)
  private dropped = 0

  constructor(private readonly maxLineBytes: number = DEFAULT_MAX_LINE_BYTES) {}

  /**
   * 喂入一块数据，返回其中完整的行（不含行尾）。
   *
   * 超过 `maxLineBytes` 仍未出现换行的数据会被丢弃（计一次 `overflow`），
   * 避免畸形输入把内存吃满；丢弃持续到下一个换行，之后恢复正常分帧。
   */
  push(chunk: Buffer | string): string[] {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    this.buffer = this.buffer.length === 0 ? buf : Buffer.concat([this.buffer, buf])

    const lines: string[] = []
    let start = 0
    for (;;) {
      const nl = this.buffer.indexOf(0x0a, start)
      if (nl < 0) break
      const raw = this.buffer.subarray(start, nl)
      start = nl + 1
      if (this.dropped > 0) {
        // 上一行已被判定超长丢弃：丢弃到本换行为止
        this.dropped = 0
        continue
      }
      lines.push(stripCr(raw).toString('utf8'))
    }
    this.buffer = start === 0 ? this.buffer : this.buffer.subarray(start)

    if (this.buffer.length > this.maxLineBytes) {
      this.buffer = Buffer.alloc(0)
      this.dropped++
    }
    return lines
  }

  /** 尚未成行的残留字节数（诊断用）。 */
  get pendingBytes(): number {
    return this.buffer.length
  }
}

function stripCr(buf: Buffer): Buffer {
  return buf.length > 0 && buf[buf.length - 1] === 0x0d ? buf.subarray(0, buf.length - 1) : buf
}
