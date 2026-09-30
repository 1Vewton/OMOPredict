import { describe, expect, it } from 'vitest'
import { resolveHostPaths } from './paths'

describe('resolveHostPaths', () => {
  it('Windows：LOCALAPPDATA\\OMOPredict（D6）', () => {
    const p = resolveHostPaths({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      home: 'C:\\Users\\me',
    })
    expect(p.dataDir).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict')
    expect(p.logsDir).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict\\logs')
    expect(p.dbPath).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict\\omopredict.db')
    expect(p.lockPath).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict\\instance.lock')
  })

  it('Windows：LOCALAPPDATA 缺失时回落到 USERPROFILE\\AppData\\Local', () => {
    const p = resolveHostPaths({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\me' },
      home: 'C:\\Users\\me',
    })
    expect(p.dataDir).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict')
  })

  it('macOS：~/Library/Application Support/OMOPredict', () => {
    const p = resolveHostPaths({ platform: 'darwin', env: {}, home: '/Users/me' })
    expect(p.dataDir).toBe('/Users/me/Library/Application Support/OMOPredict')
  })

  it('Linux：优先 XDG_DATA_HOME，目录名小写', () => {
    const p = resolveHostPaths({
      platform: 'linux',
      env: { XDG_DATA_HOME: '/data' },
      home: '/home/me',
    })
    expect(p.dataDir).toBe('/data/omopredict')
  })

  it('Linux：无 XDG_DATA_HOME 时用 ~/.local/share', () => {
    const p = resolveHostPaths({ platform: 'linux', env: {}, home: '/home/me' })
    expect(p.dataDir).toBe('/home/me/.local/share/omopredict')
  })

  it('空白环境变量按缺失处理（避免拿到空 base 拼出相对路径）', () => {
    const p = resolveHostPaths({
      platform: 'win32',
      env: { LOCALAPPDATA: '   ', USERPROFILE: 'C:\\Users\\me' },
      home: 'C:\\Users\\me',
    })
    expect(p.dataDir).toBe('C:\\Users\\me\\AppData\\Local\\OMOPredict')
  })

  it('子目录名固定为 ASCII（避免中文用户名/长路径问题）', () => {
    const p = resolveHostPaths({ platform: 'win32', env: { LOCALAPPDATA: 'D:\\appdata' } })
    expect(p.dataDir.endsWith('OMOPredict')).toBe(true)
    expect(/[\u4e00-\u9fa5]/.test(p.dataDir)).toBe(false)
  })
})
