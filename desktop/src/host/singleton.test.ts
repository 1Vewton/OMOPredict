import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SingleInstanceError, acquireSingletonLock } from './singleton'

let dir: string
let lockPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omo-lock-'))
  lockPath = join(dir, 'nested', 'instance.lock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('acquireSingletonLock', () => {
  it('首次获取成功，写出自己的 pid，并创建上层目录', () => {
    const lock = acquireSingletonLock(lockPath, { pid: 1000, isAlive: () => false })
    expect(lock.reclaimed).toBe(false)
    expect(lock.pid).toBe(1000)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(1000)

    lock.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('已有存活实例时抛 SingleInstanceError 并带上持有者 pid', () => {
    acquireSingletonLock(lockPath, { pid: 4242, isAlive: () => true })
    try {
      acquireSingletonLock(lockPath, { pid: 5151, isAlive: () => true })
      throw new Error('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(SingleInstanceError)
      expect((e as SingleInstanceError).holderPid).toBe(4242)
      expect((e as Error).message).toContain('4242')
    }
  })

  it('陈旧锁（持有者已退出）被覆盖，并标记 reclaimed', () => {
    acquireSingletonLock(lockPath, { pid: 4242, isAlive: () => true })
    const lock = acquireSingletonLock(lockPath, { pid: 5151, isAlive: () => false })
    expect(lock.reclaimed).toBe(true)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(5151)
  })

  it('损坏/空的锁文件按陈旧处理（进程被杀可能留下半截文件）', () => {
    acquireSingletonLock(lockPath, { pid: 1, isAlive: () => false }).release() // 先确保目录存在
    writeFileSync(lockPath, '') // 空文件
    const lock = acquireSingletonLock(lockPath, { pid: 2, isAlive: () => true })
    expect(lock.reclaimed).toBe(true)
    expect(lock.pid).toBe(2)
  })

  it('同一进程重复获取也算冲突：防止一进程两 Host 写同一 SQLite', () => {
    acquireSingletonLock(lockPath, { pid: 7, isAlive: () => true })
    expect(() => acquireSingletonLock(lockPath, { pid: 7, isAlive: () => true })).toThrow(
      SingleInstanceError,
    )
  })

  it('release 后可再次获取（正常重启路径）', () => {
    const first = acquireSingletonLock(lockPath, { pid: 7, isAlive: () => false })
    first.release()
    const second = acquireSingletonLock(lockPath, { pid: 7, isAlive: () => false })
    expect(second.reclaimed).toBe(false)
  })

  it('release 只删自己的锁：后来者接管后不会被误删', () => {
    const first = acquireSingletonLock(lockPath, { pid: 1, isAlive: () => false })
    const second = acquireSingletonLock(lockPath, { pid: 2, isAlive: () => false })
    first.release() // 此时锁属于 pid=2
    expect(existsSync(lockPath)).toBe(true)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(2)
    second.release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('release 幂等（重复调用不抛错）', () => {
    const lock = acquireSingletonLock(lockPath, { pid: 9, isAlive: () => false })
    lock.release()
    expect(() => lock.release()).not.toThrow()
  })

  it('默认存活判断是真实的：锁的持有者是本进程时，另一个 pid 会被挡住', () => {
    acquireSingletonLock(lockPath, { pid: process.pid }) // 写出真实存在的 pid
    expect(() => acquireSingletonLock(lockPath, { pid: 999_999 })).toThrow(SingleInstanceError)
  })
})
