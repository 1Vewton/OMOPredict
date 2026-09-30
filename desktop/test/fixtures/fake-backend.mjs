// 假后端（测试 fixture）：实现与真后端一致的 stdio JSON-RPC 2.0 行协议。
//
// 纯 JavaScript（.mjs）——由真实 node 子进程执行，不走任何转译，所以这里不能用 TS 语法。
//
// 行为由环境变量控制，便于测各种失败路径：
//   FAKE_MODE=ok              正常：ping/tasks.*，另打印 stderr 日志
//   FAKE_MODE=silent          ping 不回复（测启动 ping 超时）
//   FAKE_MODE=die             收到首个请求（含 ping）后 exit(3)
//   FAKE_MODE=die-after-ping  回 ping 正常，但收到其它请求即 exit(3)
//                             （更真实：进程起来了、健康检查过了，处理业务时才崩）
//   FAKE_MODE=die-once        首次启动即退出，第二次启动起正常工作（测自动重启）
//   FAKE_MODE=pollute         先往 stdout 打一行非 JSON（测协议污染容忍）
//   FAKE_MODE=slow            每个请求延迟 FAKE_DELAY_MS 再回复（测调用超时）
//   FAKE_STATE_FILE=<path>    die-once 用它记录"已启动过几次"
import { readFileSync, writeFileSync } from 'node:fs'

const mode = process.env.FAKE_MODE ?? 'ok'
const delayMs = Number(process.env.FAKE_DELAY_MS ?? '0')
const stateFile = process.env.FAKE_STATE_FILE

function bumpState() {
  if (!stateFile) return 1
  let n = 0
  try {
    n = Number(readFileSync(stateFile, 'utf8').trim()) || 0
  } catch {
    n = 0
  }
  n += 1
  try {
    writeFileSync(stateFile, String(n))
  } catch {
    // ignore
  }
  return n
}

const starts = bumpState()
process.stderr.write(`[fake-backend] started (mode=${mode} starts=${starts})\n`)

if (mode === 'die-once' && starts === 1) {
  process.stderr.write('[fake-backend] simulated crash on first start\n')
  process.exit(7)
}

if (mode === 'pollute') {
  // 模拟"某个依赖往 stdout 打印"：协议流被污染，但服务应当照常工作
  process.stdout.write('this line is not JSON and must be ignored\n')
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function handle(id, method, params) {
  switch (method) {
    case 'ping':
      if (mode === 'silent') return
      reply(id, { status: 'ok', version: 'fake' })
      return
    case 'meta':
      reply(id, {
        version: 'fake',
        auth_mode: 'none',
        auth_required: false,
        engine_transport: 'stdio',
      })
      return
    case 'tasks.list':
      reply(id, { tasks: [] })
      return
    case 'tasks.get':
      reply(id, { id: params?.id, status: 'succeeded' })
      return
    case 'tasks.delete':
      reply(id, { id: params?.id, deleted: true })
      return
    case 'tasks.create':
      process.stderr.write('[fake-backend] creating task\n')
      reply(id, { id: 'fake-task', status: 'pending' })
      return
    case 'boom':
      replyError(id, 422, '领域校验失败：层厚必须为正')
      return
    case 'notify':
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { done: 1, total: 2 } })}\n`,
      )
      reply(id, { ok: true })
      return
    default:
      replyError(id, -32601, `方法不存在: ${method}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (line.length === 0) continue

    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    const id = Number(msg.id)
    const method = String(msg.method ?? '')

    if (mode === 'die' || (mode === 'die-after-ping' && method !== 'ping')) {
      process.stderr.write('[fake-backend] simulated crash while handling request\n')
      process.exit(3)
    }

    const run = () => {
      if (id > 0 && Number.isFinite(id)) handle(id, method, msg.params)
    }
    if (mode === 'slow' && delayMs > 0) setTimeout(run, delayMs)
    else run()
  }
})

process.stdin.on('end', () => {
  process.stderr.write('[fake-backend] stdin closed, exiting\n')
  process.exit(0)
})
