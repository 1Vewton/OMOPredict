// `app://` 协议解析单测（docs/desktop.md D2）。
//
// 这是**安全敏感**模块：它决定渲染进程能读到磁盘上的哪些文件。
// 目录穿越的各种编码变体都必须被挡住，所以这部分用例写得比功能面更密。
import { describe, expect, it, vi } from 'vitest'
import {
  APP_HOST,
  CSP,
  MIME_TYPES,
  RESPONSE_HEADERS,
  mimeFor,
  resolveAppRequest,
} from './appProtocol'

const DIST = 'C:\\app\\resources\\dist'

/** 只把这些路径视为存在。 */
function existsOnly(paths: string[]): (p: string) => boolean {
  return (p) => paths.includes(p)
}

describe('resolveAppRequest 正常解析', () => {
  it('命中真实文件：返回磁盘路径与 MIME', () => {
    const asset = `${DIST}\\assets\\index-a1b2.js`
    const r = resolveAppRequest('app://omo/assets/index-a1b2.js', DIST, {
      exists: existsOnly([asset]),
      platform: 'win32',
    })
    expect(r).toEqual({
      filePath: asset,
      mimeType: 'text/javascript; charset=utf-8',
      spaFallback: false,
    })
  })

  it('根路径 → index.html', () => {
    const index = `${DIST}\\index.html`
    const r = resolveAppRequest('app://omo/', DIST, {
      exists: existsOnly([index]),
      platform: 'win32',
    })
    expect(r).toMatchObject({ filePath: index, spaFallback: true })
  })

  it('未知路径（深链）→ SPA 回退到 index.html', () => {
    const index = `${DIST}\\index.html`
    const r = resolveAppRequest('app://omo/tasks/abc123', DIST, {
      exists: existsOnly([index]),
      platform: 'win32',
    })
    expect(r).toMatchObject({ filePath: index, spaFallback: true })
    expect(r?.mimeType).toContain('text/html')
  })

  it('显式目录请求同样回退（不把目录当文件读）', () => {
    const dir = `${DIST}\\assets`
    const index = `${DIST}\\index.html`
    const r = resolveAppRequest('app://omo/assets/', DIST, {
      exists: existsOnly([dir, index]),
      platform: 'win32',
    })
    expect(r).toMatchObject({ filePath: index, spaFallback: true })
  })

  it('百分号编码的文件名被正确解码', () => {
    const asset = `${DIST}\\assets\\my file.css`
    const r = resolveAppRequest('app://omo/assets/my%20file.css', DIST, {
      exists: existsOnly([asset]),
      platform: 'win32',
    })
    expect(r?.filePath).toBe(asset)
  })

  it('index.html 不存在（未构建）时返回 null', () => {
    expect(resolveAppRequest('app://omo/design', DIST, { exists: () => false })).toBeNull()
  })

  it('posix 平台使用正斜杠语义', () => {
    const dist = '/app/resources/dist'
    const index = '/app/resources/dist/index.html'
    const r = resolveAppRequest('app://omo/design', dist, {
      exists: existsOnly([index]),
      platform: 'linux',
    })
    expect(r?.filePath).toBe(index)
  })
})

describe('resolveAppRequest 拒绝不该它提供的东西', () => {
  const index = `${DIST}\\index.html`

  it('其它协议或主机一律不接受', () => {
    const deps = { exists: existsOnly([index]), platform: 'win32' as const }
    expect(resolveAppRequest('http://omo/index.html', DIST, deps)).toBeNull()
    expect(resolveAppRequest('file:///C:/secret.txt', DIST, deps)).toBeNull()
    expect(resolveAppRequest('app://evil/index.html', DIST, deps)).toBeNull()
  })

  it('目录穿越被挡住（明文 ..）', () => {
    const deps = { exists: () => true, platform: 'win32' as const }
    // URL 规范化后可能已把 .. 吃掉，但无论如何都不能读到 dist 之外
    for (const url of [
      'app://omo/../secret.txt',
      'app://omo/../../Windows/System32/config/SAM',
      'app://omo/assets/../../../secret.txt',
    ]) {
      const r = resolveAppRequest(url, DIST, deps)
      if (r !== null) {
        expect(r.filePath.startsWith(`${DIST}\\`) || r.filePath === index).toBe(true)
      }
    }
  })

  it('百分号编码的穿越（%2e%2e%2f）也被挡住', () => {
    // 关键：先在**解码后**做规范化与归属校验，否则 %2e%2e%2f 能绕过
    const r = resolveAppRequest('app://omo/%2e%2e%2f%2e%2e%2fsecret.txt', DIST, {
      exists: () => true,
      platform: 'win32',
    })
    expect(r).toBeNull()
  })

  it('反斜杠穿越（Windows）被挡住', () => {
    const r = resolveAppRequest('app://omo/..%5c..%5csecret.txt', DIST, {
      exists: () => true,
      platform: 'win32',
    })
    expect(r).toBeNull()
  })

  it('盘符绝对路径被挡住（不会被当成 dist 内文件）', () => {
    const r = resolveAppRequest('app://omo/C%3A%2FWindows%2Fwin.ini', DIST, {
      exists: () => true,
      platform: 'win32',
    })
    expect(r).toBeNull()
  })

  it('含 NUL 字节的路径被挡住', () => {
    const r = resolveAppRequest('app://omo/a%00b.txt', DIST, {
      exists: () => true,
      platform: 'win32',
    })
    expect(r).toBeNull()
  })

  it('非法 URL 与非法百分号编码返回 null（不抛错）', () => {
    expect(resolveAppRequest('not a url', DIST)).toBeNull()
    expect(resolveAppRequest('app://omo/%E0%A4%A', DIST)).toBeNull()
  })

  it('无法归属的请求不会误回退 index.html', () => {
    // 若回退成 index.html，攻击者就能用 404 探测之外的方式掩盖失败；这里要求明确 null
    const spy = vi.fn(() => true)
    expect(resolveAppRequest('app://omo/%2e%2e%2fx', DIST, { exists: spy, platform: 'win32' })).toBeNull()
  })
})

describe('MIME 与安全头', () => {
  it('按扩展名给出 MIME，未知回退 octet-stream', () => {
    expect(mimeFor('a.html')).toContain('text/html')
    expect(mimeFor('a.CSS')).toContain('text/css')
    expect(mimeFor('a.woff2')).toBe('font/woff2')
    expect(mimeFor('a.unknownext')).toBe('application/octet-stream')
    expect(mimeFor('noextension')).toBe('application/octet-stream')
    expect(MIME_TYPES['.js']).toContain('javascript')
  })

  it("CSP 禁用一切网络（桌面形态走 IPC，D11）", () => {
    expect(CSP).toContain("connect-src 'none'")
    expect(CSP).toContain("default-src 'self' app:")
    expect(CSP).toContain("object-src 'none'")
    expect(RESPONSE_HEADERS['Content-Security-Policy']).toBe(CSP)
    expect(RESPONSE_HEADERS['X-Content-Type-Options']).toBe('nosniff')
  })

  it('协议名与主机与前端加载地址一致', () => {
    expect(APP_HOST).toBe('omo')
  })
})
