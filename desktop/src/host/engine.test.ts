import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeEngineFailure, discoverEngine, engineSetupGuidance, quoteIfNeeded } from './engine'

const RES = join('C:', 'app', 'resources')
const noSuch = (): boolean => false

describe('discoverEngine（D9：Host 只知道 Go 不知道的部分）', () => {
  it('已显式配置 OMO_ENGINE_CMD：原样透传、不改写', () => {
    const d = discoverEngine({
      resourcesDir: RES,
      env: { OMO_ENGINE_CMD: '"C:\\Py\\python.exe" -m omo.rpc' },
      exists: () => true,
    })
    expect(d.source).toBe('env')
    expect(d.env).toEqual({ OMO_ENGINE_CMD: '"C:\\Py\\python.exe" -m omo.rpc' })
  })

  it('空白的 OMO_ENGINE_CMD 视为未配置（继续探测）', () => {
    const d = discoverEngine({
      resourcesDir: RES,
      env: { OMO_ENGINE_CMD: '   ' },
      exists: noSuch,
      platform: 'win32',
    })
    expect(d.source).toBe('auto')
    expect(d.env).toEqual({})
  })

  it('完整包：资源目录内有 sidecar exe → 注入 OMO_ENGINE_CMD（含空格时加引号）', () => {
    const resourcesDir = join('C:', 'Program Files', 'OMOPredict', 'resources')
    const sidecar = join(resourcesDir, 'engine', 'omo-rpc.exe')
    const d = discoverEngine({
      resourcesDir,
      env: {},
      exists: (p) => p === sidecar,
      platform: 'win32',
    })
    expect(d.source).toBe('bundled-sidecar')
    expect(d.sidecarPath).toBe(sidecar)
    // 路径含空格 → 必须加引号，否则 Go 侧会按空格切成多个 argv
    expect(d.env.OMO_ENGINE_CMD).toBe(`"${sidecar}"`)
  })

  it('完整包：sidecar 与工程目录同时存在时两者都注入（sidecar 自带引擎，project 供 cwd）', () => {
    const engineDir = join(RES, 'engine')
    const d = discoverEngine({
      resourcesDir: RES,
      env: {},
      exists: (p) => p === join(engineDir, 'omo-rpc.exe') || p === join(engineDir, 'pyproject.toml'),
      platform: 'win32',
    })
    expect(d.env.OMO_ENGINE_CMD).toBe(join(engineDir, 'omo-rpc.exe'))
    expect(d.env.OMO_ENGINE_PROJECT).toBe(engineDir)
    expect(d.projectDir).toBe(engineDir)
  })

  it('轻量包：只有引擎工程（无 sidecar）→ 注入 OMO_ENGINE_PROJECT，交给 Go 用 uv/python', () => {
    const engineDir = join(RES, 'engine')
    const d = discoverEngine({
      resourcesDir: RES,
      env: {},
      exists: (p) => p === join(engineDir, 'pyproject.toml'),
      platform: 'linux',
    })
    expect(d.source).toBe('bundled-project')
    expect(d.env).toEqual({ OMO_ENGINE_PROJECT: engineDir })
    expect(d.sidecarPath).toBeUndefined()
  })

  it('非 Windows 平台不认 .exe（避免把无关文件当引擎）', () => {
    const engineDir = join(RES, 'engine')
    const d = discoverEngine({
      resourcesDir: RES,
      env: {},
      exists: (p) => p === join(engineDir, 'omo-rpc.exe'),
      platform: 'linux',
    })
    expect(d.source).toBe('auto')
  })

  it('没有 resourcesDir（开发期）→ 交给 Go 自动发现', () => {
    const d = discoverEngine({ env: {}, exists: () => true })
    expect(d.source).toBe('auto')
  })

  it('资源目录为空 → auto（不抛错）', () => {
    const d = discoverEngine({ resourcesDir: '  ', env: {}, exists: () => true })
    expect(d.source).toBe('auto')
  })
})

describe('quoteIfNeeded', () => {
  it('含空格/制表符时加引号，转义内部引号', () => {
    expect(quoteIfNeeded('C:\\py\\python.exe')).toBe('C:\\py\\python.exe')
    expect(quoteIfNeeded('C:\\Program Files\\python.exe')).toBe('"C:\\Program Files\\python.exe"')
    expect(quoteIfNeeded('a"b')).toBe('"a\\"b"')
  })
})

describe('engineSetupGuidance / describeEngineFailure（D9 第 5 级）', () => {
  it('指引包含"缺什么、装什么"，且不出现 exit code 之类无信息量的措辞', () => {
    const text = engineSetupGuidance('win32')
    expect(text).toContain('未找到可用的仿真引擎')
    expect(text).toContain('uv')
    expect(text).toContain('Python 3.12+')
    expect(text).toContain('OMO_ENGINE_CMD')
    expect(text).toContain('setup-engine.ps1')
  })

  it('Linux/macOS 指引给出 setup-engine.sh', () => {
    expect(engineSetupGuidance('linux')).toContain('setup-engine.sh')
    expect(engineSetupGuidance('darwin')).toContain('setup-engine.sh')
  })

  it('优先展示后端打印的引擎报错（Go 侧已给出可操作指引）', () => {
    const stderr = [
      '2026/09/28 engine transport: stdio → D:\\Python\\python.exe -m omo.rpc',
      'engine: 未找到可用的引擎启动方式：请设置 OMO_ENGINE_CMD 或安装 uv',
    ].join('\n')
    const text = describeEngineFailure(stderr)
    expect(text).toContain('未找到可用的引擎启动方式')
    expect(text).toContain('setup-engine.ps1')
  })

  it('没有引擎相关行时附上 stderr 尾部供排障', () => {
    const text = describeEngineFailure('something else went wrong')
    expect(text).toContain('后端输出（尾部）')
    expect(text).toContain('something else went wrong')
  })

  it('stderr 为空时也能给出指引', () => {
    const text = describeEngineFailure('   ')
    expect(text).toContain('未找到可用的仿真引擎')
    expect(text).toContain('（无）')
  })
})
