// 用本地 mock WebSocket 服务验证百炼协议实现（不需要真实 API Key）。
// 运行：DSH_PROFILE_DIR=~/.dsh/profiles/desktop node test/bailian-mock.mjs

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { 百炼合成 } from '../lib/bailian.mjs'

const require = createRequire(import.meta.url)
const wsPath = join(process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop'), 'node_modules', 'ws')
const { WebSocketServer } = require(wsPath)

const 音频 = Buffer.from('FAKE-MP3-BYTES')
let 收到文本 = ''
let 收到模型 = ''
let 收到音色 = ''

function 起服务(模式) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
      resolve({ wss, port: wss.address().port })
    })
    wss.on('connection', (socket, req) => {
      if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
        socket.close(1008, 'no auth')
        return
      }
      socket.on('message', (data, isBinary) => {
        if (isBinary) return
        const msg = JSON.parse(String(data))
        const action = msg?.header?.action
        if (action === 'run-task') {
          收到模型 = msg?.payload?.model
          收到音色 = msg?.payload?.parameters?.voice
          socket.send(JSON.stringify({ header: { event: 'task-started' } }))
        } else if (action === 'continue-task') {
          收到文本 += msg?.payload?.input?.text || ''
        } else if (action === 'finish-task') {
          if (模式 === '失败') {
            socket.send(JSON.stringify({ header: { event: 'task-failed', error_message: 'mock 拒绝' } }))
          } else {
            socket.send(音频)
            socket.send(JSON.stringify({ header: { event: 'task-finished' } }))
          }
        }
      })
    })
  })
}

function 断言(条件, 说明) {
  if (!条件) { console.error('✗ ' + 说明); process.exitCode = 1 }
  else console.log('✓ ' + 说明)
}

// ① 正常
{
  const { wss, port } = await 起服务('正常')
  const r = await 百炼合成({
    地址: 'ws://127.0.0.1:' + port,
    apiKey: 'test-key',
    模型: 'qwen-audio-3.1-tts-flash',
    音色: 'longanhuan_v3.1',
    文本: '床前明月光',
    超时毫秒: 5000,
  })
  断言(r.ok === true, '正常合成返回 ok')
  断言(r.音频 && r.音频.equals(音频), '音频字节完整拼接')
  断言(收到文本 === '床前明月光', 'continue-task 文本正确')
  断言(收到模型 === 'qwen-audio-3.1-tts-flash', 'run-task 模型正确')
  断言(收到音色 === 'longanhuan_v3.1', 'run-task 音色正确')
  wss.close()
}

// ② task-failed
{
  收到文本 = ''
  const { wss, port } = await 起服务('失败')
  const r = await 百炼合成({
    地址: 'ws://127.0.0.1:' + port,
    apiKey: 'test-key',
    模型: 'm', 音色: 'v', 文本: '你好', 超时毫秒: 5000,
  })
  断言(r.ok === false && String(r.说).includes('mock 拒绝'), 'task-failed 透出原因')
  wss.close()
}

// ③ 没 key
{
  const r = await 百炼合成({ 地址: 'ws://127.0.0.1:1', apiKey: '', 模型: 'm', 音色: 'v', 文本: 'x' })
  断言(r.ok === false && String(r.说).includes('API Key'), '缺 key 直接报错')
}

console.log(process.exitCode ? '\n有失败项' : '\n全部通过')
