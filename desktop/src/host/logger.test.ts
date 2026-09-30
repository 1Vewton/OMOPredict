import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileLogger, dateStamp, pruneLogs } from './logger'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omo-logger-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createFileLogger', () => {
  it('写入按天命名的日志文件，并回显', () => {
    const echoed: string[] = []
    const log = createFileLogger({
      dir,
      name: 'host',
      now: () => new Date(2026, 8, 28, 13, 5, 6, 7),
      echo: (l) => echoed.push(l),
    })

    log.info('启动完成')
    log.warn('注意')
    log.error('出错了')

    const file = log.currentFile()
    expect(file).toBe(join(dir, 'host-2026-09-28.log'))
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('INFO 启动完成')
    expect(content).toContain('WARN 注意')
    expect(content).toContain('ERROR 出错了')
    expect(content).toContain('2026-09-28 13:05:06.007')
    expect(echoed).toHaveLength(3)
  })

  it('日志目录不存在时自动创建', () => {
    const nested = join(dir, 'a', 'b')
    const log = createFileLogger({ dir: nested, name: 'backend', echo: null })
    log.info('x')
    expect(readdirSync(nested)).toContain(log.currentFile().split(/[\\/]/).pop())
  })

  it('cleanUpbyDay：跨天写入落到不同文件', () => {
    let clock = new Date(2026, 8, 28, 23, 59, 59)
    const log = createFileLogger({ dir, name: 'host', now: () => clock, echo: null })
    log.info('day1')
    clock = new Date(2026, 8, 29, 0, 0, 1)
    log.info('day2')

    expect(readdirSync(dir).sort()).toEqual(['host-2026-09-28.log', 'host-2026-09-29.log'])
    expect(readFileSync(join(dir, 'host-2026-09-28.log'), 'utf8')).toContain('day1')
    expect(readFileSync(join(dir, 'host-2026-09-29.log'), 'utf8')).toContain('day2')
  })

  it('写入失败不抛错（只回显失败提示），避免日志问题拖崩应用', () => {
    const echoed: string[] = []
    // 用一个"是文件而非目录"的路径制造失败
    const filePath = join(dir, 'not-a-dir')
    writeFileSync(filePath, 'x')
    const log = createFileLogger({ dir: join(filePath, 'sub'), name: 'host', echo: (l) => echoed.push(l) })
    expect(() => log.info('hello')).not.toThrow()
  })
})

describe('pruneLogs', () => {
  it('删除超出保留期的日志，保留窗口内的与当天日志（D7 保留 7 天）', () => {
    const now = new Date(2026, 8, 28, 12, 0, 0)
    const names = [
      'host-2026-09-28.log', // 今天
      'host-2026-09-22.log', // 6 天前：保留
      'host-2026-09-21.log', // 7 天前：过期（cutoff = 09-21，早于它的才删）
      'host-2026-09-01.log', // 很久以前：删
      'backend-2026-09-01.log', // 其它前缀：不动
      'host-.log', // 名字不合规：不动
      'readme.txt', // 非日志：不动
    ]
    for (const n of names) writeFileSync(join(dir, n), 'x')

    const removed = pruneLogs(dir, 'host', 7, now)

    expect(removed).toBe(1)
    const left = readdirSync(dir).sort()
    expect(left).toContain('host-2026-09-28.log')
    expect(left).toContain('host-2026-09-22.log')
    expect(left).toContain('host-2026-09-21.log')
    expect(left).not.toContain('host-2026-09-01.log')
    expect(left).toContain('backend-2026-09-01.log')
    expect(left).toContain('readme.txt')
  })

  it('创建日志时自动执行一次清理', () => {
    writeFileSync(join(dir, 'host-2000-01-01.log'), 'x')
    createFileLogger({
      dir,
      name: 'host',
      now: () => new Date(2026, 8, 28),
      echo: null,
    })
    expect(readdirSync(dir)).not.toContain('host-2000-01-01.log')
  })

  it('目录不可读时返回 0 而不抛错', () => {
    expect(pruneLogs(join(dir, 'missing'), 'host', 7, new Date())).toBe(0)
  })
})

describe('dateStamp', () => {
  it('补零成 YYYY-MM-DD（字典序可比，轮转判断依赖这一点）', () => {
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(dateStamp(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
